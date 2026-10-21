#!/usr/bin/env node

/**
 * Harness de benchmark por variante (Etapa 9).
 *
 * Compara as quatro variantes arquiteturais sobre o MESMO conjunto de clipes e,
 * quando informado, registrando a MESMA versao do modelo multimodal:
 *
 *   A (baseline)     frame unico (`deteccao`/`eventos`)     — referencia atual
 *   B (sequencia)    4 imagens, sem dados locais            — temporal "ausente"
 *   C (fundida)      4 imagens + dados locais               — temporal "basico"
 *   D (completa)     4 imagens + dados locais               — temporal "ampliado"
 *
 * Para cada variante o harness:
 *   1. le `logs/ciclos.jsonl` (registros `RegistroCiclo`, ver `src/domain/cycle.ts`)
 *      e agrega metricas por etapa (mediana e P95 de capturaMs, deteccaoMs,
 *      poseMs, maosMs, temporalMs, multimodalMs, persistenciaMs e totalMs,
 *      alem de observacoes, eventosTemporais, erros por etapa e cancelamentos);
 *   2. VERIFICA a versao do modelo multimodal usada por cada variante em
 *      `logs/visao.jsonl` (campo `modelo` das entradas, ligadas aos ciclos pelo
 *      frameId). O campo `modelo` de `eventos.jsonl` e o detector local, NAO o
 *      multimodal, e por isso nao entra nessa verificacao — o `--modelo-visao`
 *      apenas REGISTRA a intencao, a verificacao prova;
 *   3. roda a QUALIDADE por clipe, invocando o mesmo script de
 *      `npm run qualidade` (`scripts/avaliar-qualidade.mjs`) com `--json`,
 *      obtendo precisao, recall, F1, FP/min, eventos nao detectados e a
 *      distancia media de casamento (proxy de consistencia temporal);
 *   4. grava `bench/RELATORIO_VARIANTE_<A|B|C|D>_YYYYMMDD.md`;
 *   5. grava o consolidado `bench/COMPARATIVO_A_B_C_D_YYYYMMDD.md` APENAS se
 *      houver dados comparaveis. Sem ciclos concluidos suficientes, sem modelo
 *      multimodal verificado ou com o mesmo arquivo de eventos aplicado a mais
 *      de uma variante, o script nao grava o comparativo e termina com codigo
 *      nao zero (use `--permitir-inconclusivo` para gravar um diagnostico
 *      marcado como INCONCLUSIVO).
 *
 * Fase 5 (benchmark reproduzivel e decisao por dados):
 *   - `--warmups <n>` separa WARM-UP de execucao aquecida: os `n` primeiros
 *     ciclos CONCLUIDOS de cada variante sao tratados como aquecimento
 *     (compilacao/carga de modelo) e ficam FORA das medianas/P95; o cold start
 *     e reportado a parte, em ensaio proprio. Sem a flag (padrao 0) nada e
 *     excluido, preservando o comportamento anterior.
 *   - `--etapas-isoladas` acrescenta a secao "Etapas isoladas x ciclo
 *     completo": cada etapa local (captura/deteccao/pose/maos/temporal) medida
 *     por si so e depois somada no ciclo, a partir das MESMAS metricas reais de
 *     `logs/ciclos.jsonl` (nao inventa numeros). Exige amostras por etapa.
 *   - `--conjunto <nome>` registra QUAL conjunto reservado foi usado
 *     (ex.: `eval`) e entra no relatorio para provar que todas as variantes
 *     rodaram sobre o mesmo conjunto reservado.
 *   - `--min-f1`, `--max-fp-min`, `--ganho-minimo-f1`, `--custo-maximo-latencia`
 *     codificam o gate de qualidade x latencia: C/D so ficam "promoviveis a
 *     padrao" se baterem os criterios de qualidade E o ganho compensar o custo
 *     de latencia; caso contrario o veredito e "manter experimental".
 *
 * NUNCA sobrescreve `bench/BASELINE.md`: a gravacao passa por
 * `gravarRelatorioSeguro`, que recusa qualquer caminho fora do padrao
 * RELATORIO_VARIANTE_<letra>_* / COMPARATIVO_* e recusa explicitamente o
 * BASELINE.md.
 *
 * Compativel com PowerShell (Windows): todo processo filho e chamado via
 * `spawn(process.execPath, [...])` com array de argumentos — sem `&&`, sem
 * pipes, sem `head`/`tail`/`grep`, sem shell do sistema.
 *
 * Exemplos (PowerShell):
 *   node scripts/benchmark-variantes.mjs --clipes-dir bench/videos
 *   node scripts/benchmark-variantes.mjs --clipes bench/videos/webcam-mudanca.webm --variantes B,C,D
 *   node scripts/benchmark-variantes.mjs --eventos-B logs/webcam-eventos.jsonl --ciclos-D logs/ciclos.jsonl --modelo-visao qwen2.5-vl-3b-instruct
 *   node scripts/benchmark-variantes.mjs --sem-qualidade --json
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { montarAmbiente } from "./benchmark.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT_QUALIDADE = path.join(ROOT, "scripts", "avaliar-qualidade.mjs");

/**
 * Matriz de variantes do benchmark (espelha `public/perception/variantes.ts` e
 * `public/modos.ts`; a variante A nao vive la porque e o fluxo de frame unico).
 */
export const VARIANTES_BENCHMARK = [
  {
    letra: "A",
    id: "baseline",
    rotulo: "A · Baseline (frame único)",
    modo: "deteccao|eventos",
    percepcaoLocal: false,
    imagens: 1,
    dadosLocais: false,
    temporal: "ausente",
    objetivo: "referência atual (um frame por análise)",
    // Trechos de sessionId que identificam os ciclos desta variante.
    sessoes: ["variante-a", "baseline", "frame-unico", "frameunico"],
  },
  {
    letra: "B",
    id: "sequencia",
    rotulo: "B · Sequência (4 imagens, sem dados locais)",
    modo: "percepcao-sequencia",
    percepcaoLocal: false,
    imagens: 4,
    dadosLocais: false,
    temporal: "ausente",
    objetivo: "custo/benefício de mandar só a sequência de imagens",
    sessoes: ["variante-b", "percepcao-sequencia", "sequencia"],
  },
  {
    letra: "C",
    id: "fundida",
    rotulo: "C · Percepção fundida (dados locais, temporal básico)",
    modo: "percepcao-fundida",
    percepcaoLocal: true,
    imagens: 4,
    dadosLocais: true,
    temporal: "basico",
    objetivo: "contexto local estruturado com leitura temporal básica",
    sessoes: ["variante-c", "percepcao-fundida", "fundida"],
  },
  {
    letra: "D",
    id: "completa",
    rotulo: "D · Arquitetura-alvo (dados locais, temporal ampliado)",
    modo: "percepcao",
    percepcaoLocal: true,
    imagens: 4,
    dadosLocais: true,
    temporal: "ampliado",
    objetivo: "arquitetura-alvo completa",
    // "percepcao" so casa D depois de B/C terem sido descartados (o id deles
    // tambem contem "percepcao").
    sessoes: ["variante-d", "completa", "percepcao"],
  },
];

const LETRAS = VARIANTES_BENCHMARK.map((v) => v.letra);

/** Arquivo imutavel: nenhum caminho de saida pode apontar para ele. */
const ARQUIVO_IMUTAVEL = "BASELINE.md";

const USO = `
Uso: node scripts/benchmark-variantes.mjs [opcoes]

Compara as variantes A/B/C/D sobre o MESMO conjunto de clipes e registra a
versao do modelo multimodal usada por cada uma (verificada em logs/visao.jsonl
pelo frameId dos ciclos). O campo "modelo" dos eventos e o detector local e nao
conta como modelo multimodal.

Opcoes:
  --clipes-dir <dir>       Diretorio dos clipes de video (padrao: bench/videos)
  --anotacoes-dir <dir>     Diretorio das anotacoes .json (padrao: ao lado dos videos; permite separar tuning/eval)
  --clipes <a,b,...>       Lista explicita de clipes (substitui --clipes-dir)
  --variantes <A,B,C,D>    Somente estas variantes (padrao: todas)
  --ciclos <arquivo>       JSONL de RegistroCiclo (padrao: logs/ciclos.jsonl)
  --ciclos-<X> <arquivo>   Arquivo de ciclos exclusivo da variante X
  --eventos <arquivo>      JSONL de eventos (padrao: logs/eventos.jsonl)
  --eventos-<X> <arquivo>  Arquivo de eventos exclusivo da variante X
  --sessao-<X> <trecho>    Filtra ciclos da variante X por sessionId/cycleId
  --visao <arquivo>        JSONL de observacoes para verificar o modelo
                           (padrao: logs/visao.jsonl)
  --modelo <nome>          Versao do modelo multimodal usada em todas as
                           variantes (alias: --modelo-visao; tambem le
                           NEURO_MODELO_VISAO). Obrigatoria para concluir.
  --min-ciclos <n>         Minimo de ciclos CONCLUIDOS por variante (padrao: 1)
  --warmups <n>            Primeiros n ciclos concluidos de cada variante sao
                           WARM-UP: ficam fora das medianas/P95 (padrao: 0).
                           O cold start e reportado a parte.
  --etapas-isoladas        Acrescenta a secao "Etapas isoladas x ciclo
                           completo" (cada etapa local medida por si so).
  --conjunto <nome>        Registra o conjunto reservado usado (ex.: eval);
                           entra no relatorio e no comparativo.
  --min-f1 <0..1>          Gate de qualidade: F1 minimo (padrao: 0.5).
  --max-fp-min <n>         Gate de qualidade: FP/min maximo (padrao: 2).
  --ganho-minimo-f1 <0..1> Ganho minimo de F1 de C/D sobre A/B para justificar
                           o custo de latencia (padrao: 0.1).
  --custo-maximo-latencia <x> Aumento maximo da mediana de totalMs de C/D sobre
                           A/B que ainda compensa o ganho de F1 (padrao: 1.5).
  --tolerancia <ms>        Tolerancia de casamento do qualidade (padrao: 3000)
  --offset <ms>            Offset de base do qualidade (padrao: 0)
  --ignorados <tipos>      Tipos ignorados no qualidade (padrao: resumo)
  --data <YYYYMMDD>        Data nos nomes dos relatorios (padrao: hoje)
  --saida <dir>            Diretorio dos relatorios (padrao: bench)
  --sem-qualidade          Pula a qualidade; a conclusao fica restrita ao
                           desempenho (sem comparar F1/FP/min)
  --sem-relatorio          Nao grava RELATORIO_*/COMPARATIVO_*
  --permitir-inconclusivo  Grava o COMPARATIVO mesmo sem dados comparaveis,
                           com veredito INCONCLUSIVO e os problemas listados
  --json                   Imprime o resultado consolidado em JSON
  --help, -h               Esta ajuda

Saida: bench/RELATORIO_VARIANTE_<X>_YYYYMMDD.md por variante e
bench/COMPARATIVO_A_B_C_D_YYYYMMDD.md. O bench/BASELINE.md NUNCA e alterado.

Exemplos (PowerShell):
  node scripts/benchmark-variantes.mjs --clipes-dir bench/videos --anotacoes-dir bench/clipes/eval
  node scripts/benchmark-variantes.mjs --clipes bench/videos/webcam-mudanca.webm --variantes B,C,D
  node scripts/benchmark-variantes.mjs --eventos-D logs/webcam-eventos.jsonl --modelo-visao qwen2.5-vl-3b-instruct
  node scripts/benchmark-variantes.mjs --conjunto eval --anotacoes-dir bench/clipes/eval --warmups 1 --etapas-isoladas
`.trim();

function lerArgs() {
  const mapa = {
    clipesDir: "bench/videos",
    anotacoesDir: null,
    clipes: [],
    variantes: LETRAS,
    ciclos: "logs/ciclos.jsonl",
    eventos: "logs/eventos.jsonl",
    visao: "logs/visao.jsonl",
    tolerancia: 3000,
    offset: 0,
    ignorados: "resumo",
    saida: "bench",
    minCiclos: 1,
    warmups: 0,
    etapasIsoladas: false,
    conjunto: null,
    criteriosQualidade: {
      minF1: 0.5,
      maxFpMin: 2,
      ganhoMinimoF1: 0.1,
      custoMaximoLatencia: 1.5,
    },
    ciclosPorVariante: {},
    eventosPorVariante: {},
    sessoesPorVariante: {},
    modeloPorVariante: {},
    semQualidade: false,
    semRelatorio: false,
    permitirInconclusivo: false,
    json: false,
  };
  const lista = process.argv.slice(2);
  for (let i = 0; i < lista.length; i++) {
    const a = lista[i];
    const proximo = () => lista[++i] ?? "";

    // Opcoes por variante: `--ciclos-B`, `--eventos-D`, `--sessao-C`, `--modelo-B`...
    const porVariante = a.match(/^--(ciclos|eventos|sessao|modelo)-([A-Da-d])$/);
    if (porVariante) {
      const [, chave, letra] = porVariante;
      const L = letra.toUpperCase();
      const valor = proximo();
      if (chave === "ciclos") mapa.ciclosPorVariante[L] = valor;
      else if (chave === "eventos") mapa.eventosPorVariante[L] = valor;
      else if (chave === "sessao") mapa.sessoesPorVariante[L] = valor;
      else mapa.modeloPorVariante[L] = valor;
      continue;
    }

    if (a === "--clipes-dir") mapa.clipesDir = proximo();
    else if (a === "--anotacoes-dir") mapa.anotacoesDir = proximo();
    else if (a === "--clipes") mapa.clipes.push(...proximo().split(",").map((s) => s.trim()).filter(Boolean));
    else if (a === "--variantes") {
      mapa.variantes = proximo()
        .split(/[\s,]+/)
        .map((s) => s.trim().toUpperCase())
        .filter((s) => LETRAS.includes(s));
      if (!mapa.variantes.length) mapa.variantes = LETRAS;
    } else if (a === "--ciclos") mapa.ciclos = proximo();
    else if (a === "--eventos") mapa.eventos = proximo();
    else if (a === "--visao") mapa.visao = proximo();
    else if (a === "--help" || a === "-h") mapa.help = true;
    else if (a === "--tolerancia") mapa.tolerancia = Math.max(0, Number(proximo()) || 0);
    else if (a === "--offset") mapa.offset = Number(proximo()) || 0;
    else if (a === "--ignorados") mapa.ignorados = proximo();
    else if (a === "--modelo" || a === "--modelo-visao") mapa.modeloVisao = proximo();
    else if (a === "--min-ciclos") mapa.minCiclos = Math.max(1, Number(proximo()) || 1);
    else if (a === "--warmups") mapa.warmups = Math.max(0, Number(proximo()) || 0);
    else if (a === "--etapas-isoladas") mapa.etapasIsoladas = true;
    else if (a === "--conjunto") mapa.conjunto = proximo().trim() || null;
    else if (a === "--min-f1") mapa.criteriosQualidade.minF1 = clamp01(proximo());
    else if (a === "--max-fp-min") mapa.criteriosQualidade.maxFpMin = Math.max(0, Number(proximo()) || 0);
    else if (a === "--ganho-minimo-f1") mapa.criteriosQualidade.ganhoMinimoF1 = clamp01(proximo());
    else if (a === "--custo-maximo-latencia")
      mapa.criteriosQualidade.custoMaximoLatencia = Math.max(1, Number(proximo()) || 1);
    else if (a === "--data") mapa.data = proximo().replace(/[^0-9]/g, "");
    else if (a === "--saida") mapa.saida = proximo();
    else if (a === "--sem-qualidade") mapa.semQualidade = true;
    else if (a === "--sem-relatorio") mapa.semRelatorio = true;
    else if (a === "--permitir-inconclusivo") mapa.permitirInconclusivo = true;
    else if (a === "--json") mapa.json = true;
  }
  return mapa;
}

const arredondar = (n, casas = 0) => {
  if (!Number.isFinite(n)) return null;
  const fator = 10 ** casas;
  return Math.round(n * fator) / fator;
};

function mediana(valores) {
  if (!valores.length) return null;
  const ordenado = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenado.length / 2);
  return ordenado.length % 2 ? ordenado[meio] : (ordenado[meio - 1] + ordenado[meio]) / 2;
}

/** Percentil por interpolacao linear (P95 = 0.95). */
function percentil(valores, p) {
  if (!valores.length) return null;
  const ordenado = [...valores].sort((a, b) => a - b);
  const pos = (ordenado.length - 1) * p;
  const base = Math.floor(pos);
  const resto = pos - base;
  const proximo = ordenado[base + 1];
  return proximo === undefined ? ordenado[base] : ordenado[base] + resto * (proximo - ordenado[base]);
}

/** Converte um valor de CLI para o intervalo [0, 1] (NaN vira 0). */
function clamp01(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** Soma com valores ausentes tratados como 0 (nunca NaN). */
function somaSegura(valores) {
  return valores.reduce((acc, n) => acc + (Number.isFinite(n) ? n : 0), 0);
}

const f1 = (precisao, recall) => (precisao + recall > 0 ? (2 * precisao * recall) / (precisao + recall) : 0);

function dataHoraCurta(agora = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${agora.getFullYear()}${p(agora.getMonth() + 1)}${p(agora.getDate())}`;
}

async function existe(caminho) {
  return access(caminho).then(
    () => true,
    () => false
  );
}

const EXTENSOES_VIDEO = /\.(mp4|webm|mkv|avi|mov)$/i;

/**
 * Identidade do clipe: tamanho e SHA-256. Serve para provar que as variantes
 * rodaram sobre os MESMOS bytes, nao apenas sobre nomes de arquivo iguais.
 */
export async function resumoDoClipe(caminho) {
  const abs = path.resolve(ROOT, caminho);
  const dados = await readFile(abs).catch(() => null);
  if (dados === null) return { tamanhoBytes: null, sha256: null };
  return {
    tamanhoBytes: dados.length,
    sha256: createHash("sha256").update(dados).digest("hex"),
  };
}

/**
 * Descobre os clipes e suas anotacoes em um diretorio. A anotacao e procurada,
 * por precedencia, em `anotacoesDir/<base>.json` (quando `--anotacoes-dir` e
 * informado — permite conjuntos tuning/eval com os videos em outro lugar) e
 * depois ao lado do video (`<clipe>.json`).
 */
export async function descobrirClipes(dir, explicitos = [], anotacoesDir = null) {
  const acharAnotacao = async (abs, base) => {
    const candidatos = [];
    if (anotacoesDir) candidatos.push(path.resolve(ROOT, anotacoesDir, `${base}.json`));
    candidatos.push(`${abs.slice(0, abs.length - path.extname(abs).length)}.json`);
    for (const c of candidatos) {
      if (await existe(c)) return path.relative(ROOT, c);
    }
    return null;
  };
  const paraPar = async (caminhoRel) => {
    const abs = path.resolve(ROOT, caminhoRel);
    const base = path.basename(abs).replace(EXTENSOES_VIDEO, "");
    return {
      nome: path.basename(abs),
      base,
      caminho: path.relative(ROOT, abs),
      anotacao: await acharAnotacao(abs, base),
      ...(await resumoDoClipe(abs)),
    };
  };

  if (explicitos.length) return Promise.all(explicitos.map(paraPar));

  const absoluta = path.resolve(ROOT, dir);
  const arquivos = (await readdir(absoluta).catch(() => []))
    .filter((f) => EXTENSOES_VIDEO.test(f))
    .sort();
  return Promise.all(arquivos.map((f) => paraPar(path.join(dir, f))));
}

/** Le `logs/ciclos.jsonl` (RegistroCiclo), ignorando linhas corrompidas. */
export async function lerCiclos(caminho) {
  const abs = path.resolve(ROOT, caminho);
  const texto = await readFile(abs, "utf8").catch(() => null);
  if (texto === null) return { registros: [], encontrado: false };
  const registros = [];
  for (const linha of texto.split(/\r?\n/)) {
    const limpa = linha.trim();
    if (!limpa) continue;
    try {
      const reg = JSON.parse(limpa);
      if (typeof reg?.sessionId === "string" && typeof reg?.cycleId === "string") registros.push(reg);
    } catch {
      // linha corrompida: ignora
    }
  }
  return { registros, encontrado: true };
}

/**
 * Identifica a variante de um registro de ciclo pelo `sessionId` (heuristica;
 * o id do modo multiframe tambem vale). B/C são checados antes de D porque o
 * id de D ("percepcao") e substring dos outros.
 */
export function identificarVarianteDoRegistro(registro) {
  const texto = `${registro?.sessionId ?? ""} ${registro?.cycleId ?? ""}`.toLowerCase();
  const ordem = ["B", "C", "D", "A"];
  for (const letra of ordem) {
    const variante = VARIANTES_BENCHMARK.find((v) => v.letra === letra);
    if (variante.sessoes.some((trecho) => texto.includes(trecho))) return letra;
  }
  return null;
}

/** Registros de uma variante: filtro explicito (`--sessao-X`) ou heuristica. */
export function filtrarCiclosDaVariante(registros, letra, sessaoExplicita) {
  if (sessaoExplicita) {
    const trecho = sessaoExplicita.toLowerCase();
    return registros.filter((r) => `${r.sessionId} ${r.cycleId}`.toLowerCase().includes(trecho));
  }
  return registros.filter((r) => identificarVarianteDoRegistro(r) === letra);
}

const ETAPAS_MS = [
  "capturaMs",
  "deteccaoMs",
  "poseMs",
  "maosMs",
  "temporalMs",
  "multimodalMs",
  "persistenciaMs",
  "totalMs",
];

/**
 * Etapas LOCAIS (nao incluem o multimodal remoto nem o total do ciclo). Serve
 * para a secao "etapas isoladas": cada uma deve caber sozinha no orcamento
 * antes de somar o ciclo inteiro. A ordem e a ordem real do pipeline.
 */
const ETAPAS_LOCAIS = ["capturaMs", "deteccaoMs", "poseMs", "maosMs", "temporalMs"];

/**
 * Ciclo que chegou ao fim COM interpretacao e registro: nao cancelado, com
 * frames e com `concluidoEm`. Um diagnostico parcial/cancelado nao conta como
 * amostra valida para comparar variantes.
 */
export function ehCicloConcluido(registro) {
  return (
    registro?.cancelado !== true &&
    Array.isArray(registro?.frameIds) &&
    registro.frameIds.length > 0 &&
    typeof registro?.concluidoEm === "string" &&
    registro.concluidoEm.length > 0
  );
}

/** Agrega metricas de desempenho de uma lista de `RegistroCiclo`. */
export function agregarMetricasCiclos(registros) {
  const metricas = {};
  for (const etapa of ETAPAS_MS) {
    const valores = registros
      .map((r) => Number(r?.metricas?.[etapa]))
      .filter((n) => Number.isFinite(n) && n > 0);
    metricas[etapa] = {
      medianaMs: arredondar(mediana(valores)),
      p95Ms: arredondar(percentil(valores, 0.95)),
      amostras: valores.length,
    };
  }

  const errosPorEtapa = {};
  let ciclosComErro = 0;
  for (const r of registros) {
    const erros = Array.isArray(r.erros) ? r.erros : [];
    if (erros.length) ciclosComErro++;
    for (const e of erros) {
      const etapa = typeof e?.etapa === "string" ? e.etapa : "desconhecida";
      errosPorEtapa[etapa] = (errosPorEtapa[etapa] ?? 0) + 1;
    }
  }

  const subsistemas = {};
  for (const r of registros) {
    for (const s of Array.isArray(r.subsistemasIndisponiveis) ? r.subsistemasIndisponiveis : []) {
      subsistemas[s] = (subsistemas[s] ?? 0) + 1;
    }
  }

  const soma = (fn) => registros.reduce((acc, r) => acc + (fn(r) ?? 0), 0);
  return {
    ciclos: registros.length,
    /** Amostras validas para comparar: concluidos, nao cancelados. */
    ciclosConcluidos: registros.filter(ehCicloConcluido).length,
    framesPorCiclo: arredondar(mediana(registros.map((r) => r.frameIds?.length ?? r.observacoes ?? 0).filter(Number.isFinite)), 1),
    observacoes: soma((r) => r.observacoes),
    eventosTemporais: soma((r) => r.eventosTemporais),
    ciclosComErro,
    errosPorEtapa,
    cancelados: registros.filter((r) => r.cancelado === true).length,
    subsistemasIndisponiveis: subsistemas,
    metricas,
  };
}

/**
 * Separa os primeiros `warmups` ciclos CONCLUIDOS de cada variante (aquecimento
 * de modelo/compilacao) do regime aquecido. O warm-up nao entra nas medianas do
 * comparativo; o cold start e reportado a parte, em ensaio proprio (Fase 5, item
 * 2). `warmups = 0` devolve tudo em `aquecido`, preservando o comportamento
 * anterior ao benchmark.
 *
 * A separacao e feita sobre os ciclos CONCLUIDOS e na ordem de `concluidoEm`
 * (ou da lista, se ausente) — um ciclo cancelado no inicio nao conta como
 * amostra de aquecimento.
 */
export function separarWarmupCiclos(registros, warmups = 0) {
  const n = Math.max(0, Math.floor(warmups));
  if (!n) return { warmup: [], aquecido: [...registros] };

  const comIndice = registros.map((r, i) => ({ r, i }));
  const concluidos = comIndice
    .filter(({ r }) => ehCicloConcluido(r))
    .sort((a, b) => {
      const ta = Date.parse(a.r?.concluidoEm ?? "");
      const tb = Date.parse(b.r?.concluidoEm ?? "");
      if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
      return a.i - b.i;
    });

  const indicesWarmup = new Set(concluidos.slice(0, n).map(({ i }) => i));
  const warmup = registros.filter((_, i) => indicesWarmup.has(i));
  const aquecido = registros.filter((_, i) => !indicesWarmup.has(i));
  return { warmup, aquecido };
}

/**
 * Mede cada etapa local ISOLADAMENTE (item 3 da Fase 5) a partir das metricas
 * reais de `logs/ciclos.jsonl`. Por etapa devolve mediana/P95/maximo/amostras e
 * quanto ela representa do `totalMs` mediano observado. Tambem compara a SOMA
 * das etapas locais com o total do ciclo, para expor o que fica de fora
 * (ex.: multimodal, persistencia) — sem inventar nenhum numero.
 *
 * `cobertura`: fracao dos ciclos que registraram a etapa. Etapa ausente (ex.:
 * maos quando o subsistema esta indisponivel) vem com `amostras: 0` e fica
 * marcada em `ausentes`, em vez de virar zero silencioso.
 */
export function agregarEtapasIsoladas(registros) {
  const ciclos = registros.length;
  const etapas = ETAPAS_LOCAIS.map((etapa) => {
    const valores = registros
      .map((r) => Number(r?.metricas?.[etapa]))
      .filter((n) => Number.isFinite(n) && n > 0);
    return {
      etapa,
      amostras: valores.length,
      medianaMs: arredondar(mediana(valores)),
      p95Ms: arredondar(percentil(valores, 0.95)),
      maximoMs: valores.length ? arredondar(Math.max(...valores)) : null,
      cobertura: ciclos ? arredondar(valores.length / ciclos, 3) : null,
    };
  });

  const ausentes = etapas.filter((e) => e.amostras === 0).map((e) => e.etapa);

  // Totais por ciclo: soma das etapas locais presentes x totalMs real.
  const totais = registros
    .map((r) => {
      const locais = ETAPAS_LOCAIS.map((etapa) => Number(r?.metricas?.[etapa])).filter(
        (n) => Number.isFinite(n) && n > 0
      );
      const total = Number(r?.metricas?.totalMs);
      if (!locais.length || !Number.isFinite(total) || total <= 0) return null;
      return { locais: somaSegura(locais), total, multimodal: Number(r?.metricas?.multimodalMs) };
    })
    .filter(Boolean);

  return {
    ciclos,
    etapas,
    ausentes,
    /** Mediana da soma das etapas locais por ciclo (o "ciclo local"). */
    somaLocalMedianaMs: arredondar(mediana(totais.map((t) => t.locais))),
    /** Mediana do totalMs real do ciclo (o ciclo completo). */
    totalMedianaMs: arredondar(mediana(totais.map((t) => t.total))),
    /** Mediana do multimodal (o que sobra entre o ciclo local e o completo). */
    multimodalMedianaMs: arredondar(
      mediana(totais.map((t) => t.multimodal).filter((n) => Number.isFinite(n) && n > 0))
    ),
    amostras: totais.length,
  };
}

/**
 * Gate de qualidade x latencia (itens 5 e 6 da Fase 5). Diz, por variante, se
 * ela ATINGE os criterios de qualidade definidos previamente e se o ganho de F1
 * sobre a referencia compensa o custo de latencia. C/D so ficam "promoviveis a
 * padrao" quando:
 *   1. F1 >= minF1 e FP/min <= maxFpMin (criterio de qualidade);
 *   2. o ganho de F1 sobre a melhor referencia (A/B) >= ganhoMinimoF1;
 *   3. o total mediano nao passa de `custoMaximoLatencia` vezes o da referencia.
 * Caso contrario a recomendacao e "manter experimental". Sem qualidade
 * consolidada ou sem dados de latencia, a variante fica "sem dados" — nunca
 * promovida.
 */
export function avaliarGateQualidade(resultados, criterios = {}) {
  const {
    minF1 = 0.5,
    maxFpMin = 2,
    ganhoMinimoF1 = 0.1,
    custoMaximoLatencia = 1.5,
  } = criterios;

  const dados = resultados.map((r) => {
    const c = r.qualidade?.consolidado ?? null;
    const m = r.desempenho?.metricas ?? {};
    return {
      letra: r.variante.letra,
      f1: c?.f1 ?? null,
      precisao: c?.precisao ?? null,
      recall: c?.recall ?? null,
      falsosPositivosPorMinuto: c?.falsosPositivosPorMinuto ?? null,
      totalMedianaMs: m.totalMs?.medianaMs ?? null,
      ciclosConcluidos: r.desempenho?.ciclosConcluidos ?? 0,
    };
  });

  // Referencia de latencia/qualidade: a MELHOR variante de referencia (A ou B)
  // com qualidade. Se nenhuma referencia tiver dados, usa a media das demais.
  const referencias = dados.filter(
    (d) => (d.letra === "A" || d.letra === "B") && d.f1 !== null && d.totalMedianaMs !== null
  );
  const refF1 = referencias.length ? Math.max(...referencias.map((d) => d.f1)) : null;
  const refTotal = referencias.length
    ? Math.min(...referencias.map((d) => d.totalMedianaMs))
    : null;

  const porVariante = dados.map((d) => {
    const motivos = [];
    const temDados = d.f1 !== null && d.totalMedianaMs !== null;
    if (!temDados) {
      if (d.f1 === null) motivos.push("sem qualidade consolidada");
      if (d.totalMedianaMs === null) motivos.push("sem latencia total medida");
      return { ...d, atende: false, promovivel: false, motivo: motivos.join("; ") };
    }
    const atendeF1 = d.f1 >= minF1;
    const atendeFp = d.falsosPositivosPorMinuto === null || d.falsosPositivosPorMinuto <= maxFpMin;
    if (!atendeF1) motivos.push(`F1 ${pctCurto(d.f1)} abaixo do minimo ${pctCurto(minF1)}`);
    if (!atendeFp)
      motivos.push(`FP/min ${num(d.falsosPositivosPorMinuto)} acima do maximo ${num(maxFpMin)}`);
    const atende = atendeF1 && atendeFp;

    // Ganho de qualidade x custo de latencia (so faz sentido para C/D, que
    // acrescentam dados locais/temporal sobre a referencia).
    let ganhoF1 = null;
    let taxaCusto = null;
    let compensa = true;
    if (refF1 !== null) {
      ganhoF1 = arredondar(d.f1 - refF1, 3);
      if (ganhoF1 < ganhoMinimoF1) {
        compensa = false;
        motivos.push(`ganho de F1 (${pctCurto(ganhoF1)}) abaixo do minimo ${pctCurto(ganhoMinimoF1)}`);
      }
    }
    if (refTotal !== null && refTotal > 0) {
      taxaCusto = arredondar(d.totalMedianaMs / refTotal, 3);
      if (taxaCusto > custoMaximoLatencia) {
        compensa = false;
        motivos.push(
          `latencia ${num(taxaCusto)}x a referencia, acima do teto ${num(custoMaximoLatencia)}x`
        );
      }
    }

    const promovivel = atende && compensa;
    if (promovivel && !motivos.length) motivos.push("atende aos criterios de qualidade e compensa o custo");
    return { ...d, atende, ganhoF1, taxaCusto, compensa, promovivel, motivo: motivos.join("; ") };
  });

  const experimentais = porVariante.filter((p) => !p.promovivel).map((p) => p.letra);
  return {
    criterios: { minF1, maxFpMin, ganhoMinimoF1, custoMaximoLatencia },
    referencia: { letra: referencias.map((r) => r.letra).join("/") || null, f1: refF1, totalMedianaMs: refTotal },
    porVariante,
    /** Variantes que NAO devem ser promovidas a padrao com estes dados. */
    experimentais,
  };
}

/** Percentual curto (0..1) para mensagens de gate, sem arredondar centavos. */
function pctCurto(n) {
  return Number.isFinite(n) ? `${(Math.round(n * 1000) / 10).toFixed(1)}%` : "—";
}

/**
 * Resolve o arquivo de eventos de uma variante: `--eventos-X` >
 * `logs/eventos-<variante>.jsonl` > `logs/eventos-<id>.jsonl` > `--eventos` >
 * `logs/eventos.jsonl`.
 */
export async function resolverArquivoEventos(variante, args) {
  const candidatos = [
    args.eventosPorVariante[variante.letra],
    `logs/eventos-${variante.letra}.jsonl`,
    `logs/eventos-${variante.id}.jsonl`,
    args.eventos,
  ].filter(Boolean);
  for (const c of candidatos) {
    if (await existe(path.resolve(ROOT, c))) return c;
  }
  return null;
}

/** Resolve o arquivo de ciclos de uma variante (`--ciclos-X` > `--ciclos`). */
export async function resolverArquivoCiclos(variante, args) {
  const candidatos = [args.ciclosPorVariante[variante.letra], args.ciclos].filter(Boolean);
  for (const c of candidatos) {
    if (await existe(path.resolve(ROOT, c))) return c;
  }
  return candidatos[0] ?? args.ciclos;
}

// ---------------------------------------------------------------------------
// Garantia de mesmo clipe e mesma versao do modelo multimodal
// ---------------------------------------------------------------------------

/** Le um JSONL generico e devolve os valores distintos do campo `modelo`. */
export async function extrairModelosDoJsonl(caminho) {
  if (!caminho) return [];
  const abs = path.resolve(ROOT, caminho);
  const texto = await readFile(abs, "utf8").catch(() => null);
  if (texto === null) return [];
  const modelos = new Set();
  for (const linha of texto.split(/\r?\n/)) {
    const limpa = linha.trim();
    if (!limpa) continue;
    try {
      const reg = JSON.parse(limpa);
      if (typeof reg?.modelo === "string" && reg.modelo.trim()) modelos.add(reg.modelo.trim());
    } catch {
      // linha corrompida: ignora
    }
  }
  return [...modelos].sort();
}

/**
 * Modelos citados nas observacoes (`logs/visao.jsonl`, campo `modelo`) dos
 * frames de uma variante. Como `RegistroCiclo.frameIds` liga cada ciclo aos
 * frames que o compuseram, isto prova com que modelo os ciclos da variante
 * realmente rodaram (o `--modelo-visao` apenas REGISTRA; isto VERIFICA).
 */
export async function modelosDosFrames(caminhoVisao, frameIds) {
  const alvo = new Set((frameIds ?? []).filter((f) => typeof f === "string" && f));
  if (!alvo.size) return [];
  const abs = path.resolve(ROOT, caminhoVisao);
  const texto = await readFile(abs, "utf8").catch(() => null);
  if (texto === null) return [];
  const modelos = new Set();
  for (const linha of texto.split(/\r?\n/)) {
    const limpa = linha.trim();
    if (!limpa) continue;
    try {
      const reg = JSON.parse(limpa);
      if (reg?.frameId && alvo.has(reg.frameId) && typeof reg.modelo === "string" && reg.modelo.trim()) {
        modelos.add(reg.modelo.trim());
      }
    } catch {
      // linha corrompida: ignora
    }
  }
  return [...modelos].sort();
}

/**
 * Confere se todas as variantes rodaram com a MESMA versao do modelo
 * multimodal, usando SOMENTE `logs/visao.jsonl` (entradas do multimodal ligadas
 * aos ciclos pelo frameId). O campo `modelo` dos eventos e o detector local e
 * nao serve para essa prova. `consistente` e falso se houver qualquer aviso.
 */
export function verificarMesmoModelo(resultados, modeloGlobal) {
  const porVariante = resultados.map(({ variante, modelos }) => ({
    letra: variante.letra,
    modelos: [...new Set(modelos?.visao ?? [])].sort(),
  }));
  const todos = [...new Set(porVariante.flatMap((p) => p.modelos))].sort();
  const avisos = [];
  const comDados = porVariante.filter((p) => p.modelos.length);

  if (comDados.length >= 2) {
    const divergentes = comDados.filter((p) => p.modelos.join("|") !== comDados[0].modelos.join("|"));
    if (divergentes.length) {
      avisos.push(
        `modelos divergentes entre variantes: ${comDados
          .map((p) => `${p.letra}=[${p.modelos.join(", ")}]`)
          .join(" vs ")} — todas as variantes devem rodar com o mesmo modelo`
      );
    }
  }
  if (modeloGlobal) {
    const esperado = modeloGlobal.trim().toLowerCase();
    for (const p of comDados) {
      const fora = p.modelos.filter((m) => m.toLowerCase() !== esperado);
      if (fora.length) {
        avisos.push(
          `variante ${p.letra} registrou modelo diferente do --modelo: [${fora.join(", ")}] vs "${modeloGlobal}"`
        );
      }
    }
  }
  if (!todos.length) {
    avisos.push(
      "nao foi possivel verificar a versao do modelo multimodal (sem campo `modelo` em visao.jsonl para os frames dos ciclos); confirme manualmente que todas as variantes usaram o mesmo modelo"
    );
  }
  return { consistente: avisos.length === 0, modelos: todos, porVariante, avisos };
}

/**
 * Decide se os resultados permitem uma CONCLUSAO comparativa. O criterio e
 * deliberadamente conservador: sem ciclos concluidos, sem modelo multimodal
 * verificado e sem qualidade propria por variante, o harness nao escolhe
 * vencedores.
 *
 * `resultados`: `{ variante, desempenho, qualidade, arquivoEventos,
 * arquivoCiclos, registros, sessaoExplicita, modelos }`.
 */
export function avaliarComparabilidade(resultados, opcoes = {}) {
  const {
    modeloGlobal = "",
    minCiclosValidos = 1,
    exigirQualidade = true,
    exigirMultiplasVariantes = true,
  } = opcoes;
  const problemas = [];
  const porVariante = [];

  if (exigirMultiplasVariantes && resultados.length < 2) {
    problemas.push("menos de duas variantes selecionadas: nao ha comparacao a fazer");
  }
  if (!String(modeloGlobal).trim()) {
    problemas.push("modelo multimodal nao registrado: use --modelo/--modelo-visao");
  }

  // O mesmo arquivo de eventos aplicado a varias variantes repete as mesmas
  // metricas de qualidade (foi o defeito do comparativo de 2026-10-18). So
  // importa quando a qualidade entra na conclusao.
  const donoDoEvento = new Map();
  if (exigirQualidade) {
    for (const r of resultados) {
      if (!r.arquivoEventos) continue;
      const abs = path.resolve(ROOT, r.arquivoEventos);
      const donos = donoDoEvento.get(abs) ?? [];
      donos.push(r.variante.letra);
      donoDoEvento.set(abs, donos);
    }
  }
  for (const [arquivo, donos] of donoDoEvento) {
    if (donos.length > 1) {
      problemas.push(
        `arquivo de eventos compartilhado por ${donos.join(", ")}: ${path.relative(ROOT, arquivo)} — a qualidade seria identica entre variantes; grave um arquivo por variante`
      );
    }
  }

  // Sessoes nao podem ser reaproveitadas entre variantes.
  const donoDaSessao = new Map();
  for (const r of resultados) {
    for (const reg of r.registros ?? []) {
      const chave = `${reg.sessionId ?? "?"}/${reg.cycleId ?? "?"}`;
      const dono = donoDaSessao.get(chave);
      if (dono && dono !== r.variante.letra) {
        problemas.push(`ciclo ${chave} aparece nas variantes ${dono} e ${r.variante.letra}`);
      } else {
        donoDaSessao.set(chave, r.variante.letra);
      }
    }
  }

  for (const r of resultados) {
    const letra = r.variante.letra;
    // Com warm-up separado, a contagem valida e a do regime AQUECIDO (o
    // aquecimento nao serve como amostra para decidir arquitetura).
    const desempenhoValido = r.desempenhoAquecido ?? r.desempenho;
    const concluidos = desempenhoValido?.ciclosConcluidos ?? 0;
    const modelos = [...new Set(r.modelos?.visao ?? [])];
    const problemasDaVariante = [];

    if (concluidos < minCiclosValidos) {
      problemasDaVariante.push(
        `${concluidos} ciclo(s) concluido(s), abaixo do minimo ${minCiclosValidos}`
      );
    }
    if (!r.arquivoEventos) {
      if (exigirQualidade) problemasDaVariante.push("sem arquivo de eventos");
    }
    if (!modelos.length) {
      problemasDaVariante.push("modelo multimodal nao observado em visao.jsonl (frameIds dos ciclos)");
    } else if (modelos.length > 1) {
      problemasDaVariante.push(`mais de um modelo multimodal observado: [${modelos.join(", ")}]`);
    }
    if (r.sessaoExplicita === false) {
      for (const reg of r.registros ?? []) {
        if (identificarVarianteDoRegistro(reg) !== letra) {
          problemasDaVariante.push(
            `ciclo ${reg.sessionId ?? "?"}/${reg.cycleId ?? "?"} nao corresponde a variante ${letra}`
          );
          break;
        }
      }
    }
    if (exigirQualidade && !r.qualidade?.consolidado) {
      problemasDaVariante.push("sem qualidade consolidada (anotacoes/eventos ausentes ou ilegiveis)");
    }

    if (problemasDaVariante.length) {
      problemas.push(...problemasDaVariante.map((p) => `${letra}: ${p}`));
    }
    porVariante.push({
      letra,
      ciclos: desempenhoValido?.ciclos ?? 0,
      ciclosConcluidos: concluidos,
      warmups: r.warmups ?? 0,
      cancelados: desempenhoValido?.cancelados ?? 0,
      modelos,
      qualidade: Boolean(r.qualidade?.consolidado),
      arquivoEventos: r.arquivoEventos ?? null,
    });
  }

  const verificacaoModelo = verificarMesmoModelo(resultados, modeloGlobal);
  for (const aviso of verificacaoModelo.avisos) problemas.push(`modelo: ${aviso}`);

  return {
    conclusivo: problemas.length === 0,
    problemas: [...new Set(problemas)],
    porVariante,
    verificacaoModelo,
  };
}

/**
 * Roda a QUALIDADE de um clipe (`npm run qualidade -- ... --json`), invocando o
 * mesmo script que o npm chama. `spawn` com array de argumentos funciona igual
 * em PowerShell, CMD e shells Unix (sem interpretar o shell do sistema).
 */
export function executarQualidade({ anotacao, eventos, tolerancia, offset, ignorados }) {
  return new Promise((resolve) => {
    const args = [SCRIPT_QUALIDADE, "--anotacao", anotacao, "--eventos", eventos, "--json"];
    if (Number.isFinite(tolerancia)) args.push("--tolerancia", String(tolerancia));
    if (Number.isFinite(offset) && offset !== 0) args.push("--offset", String(offset));
    if (ignorados) args.push("--ignorados", ignorados);

    const filho = spawn(process.execPath, args, { cwd: ROOT, windowsHide: true });
    let stdout = "";
    let stderr = "";
    filho.stdout.on("data", (d) => (stdout += d));
    filho.stderr.on("data", (d) => (stderr += d));
    filho.on("error", (err) => resolve({ ok: false, erro: err.message }));
    filho.on("close", (code) => {
      if (code !== 0) {
        resolve({ ok: false, erro: stderr.trim() || `qualidade terminou com codigo ${code}` });
        return;
      }
      try {
        resolve({ ok: true, dados: JSON.parse(stdout) });
      } catch {
        resolve({ ok: false, erro: `saida de --json ilegivel: ${stdout.slice(0, 200)}` });
      }
    });
  });
}

/** Avalia TODOS os clipes de uma variante contra o arquivo de eventos dela. */
async function avaliarQualidadeDaVariante(variante, clipes, arquivoEventos, args) {
  const porClip = [];
  for (const clipe of clipes) {
    if (!clipe.anotacao) {
      porClip.push({ clipe: clipe.nome, pulado: true, motivo: "sem anotacao (<clipe>.json)" });
      continue;
    }
    const r = await executarQualidade({
      anotacao: clipe.anotacao,
      eventos: arquivoEventos,
      tolerancia: args.tolerancia,
      offset: args.offset,
      ignorados: args.ignorados,
    });
    if (!r.ok) {
      porClip.push({ clipe: clipe.nome, pulado: true, motivo: r.erro });
      continue;
    }
    const d = r.dados;
    porClip.push({
      clipe: clipe.nome,
      precisao: d.precisao,
      recall: d.recall,
      f1: f1(d.precisao, d.recall),
      falsosPositivosPorMinuto: d.falsosPositivosPorMinuto,
      verdadeirosPositivos: d.verdadeirosPositivos,
      falsosPositivos: d.falsosPositivos,
      perdidos: d.perdidos,
      duracaoMs: d.duracaoMs,
      // Proxy de consistencia temporal: distancia media entre o evento real e
      // a deteccao que casou com ele (menor = mais proximo do instante real).
      distanciaMediaMs: Array.isArray(d.correspondencias) && d.correspondencias.length
        ? arredondar(
            d.correspondencias.reduce((s, c) => s + (c.distanciaMs ?? 0), 0) / d.correspondencias.length
          )
        : null,
    });
  }

  const avaliados = porClip.filter((p) => !p.pulado);
  if (!avaliados.length) return { porClip, consolidado: null };

  // Consolidado por SOMA de TP/FP/FN (nao media de medias).
  const tp = avaliados.reduce((s, a) => s + (a.verdadeirosPositivos ?? 0), 0);
  const fp = avaliados.reduce((s, a) => s + (a.falsosPositivos ?? 0), 0);
  const fn = avaliados.reduce((s, a) => s + (a.perdidos ?? 0), 0);
  const duracaoMs = avaliados.reduce((s, a) => s + (a.duracaoMs ?? 0), 0);
  const precisao = tp + fp > 0 ? tp / (tp + fp) : 1;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 1;
  const distancias = avaliados.map((a) => a.distanciaMediaMs).filter(Number.isFinite);
  return {
    porClip,
    consolidado: {
      clipes: avaliados.length,
      precisao,
      recall,
      f1: f1(precisao, recall),
      falsosPositivosPorMinuto: duracaoMs > 0 ? fp / (duracaoMs / 60_000) : 0,
      verdadeirosPositivos: tp,
      falsosPositivos: fp,
      eventosNaoDetectados: fn,
      duracaoMs,
      distanciaMediaMs: distancias.length
        ? arredondar(distancias.reduce((s, d) => s + d, 0) / distancias.length)
        : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Gravacao segura (nunca sobrescrever bench/BASELINE.md)
// ---------------------------------------------------------------------------

const PADRAO_RELATORIO = /^(RELATORIO_VARIANTE_[ABCD]_|COMPARATIVO_[ABCD](_[ABCD])*_)\d+\.md$/;

/**
 * Grava um relatorio somente se o nome seguir o padrao
 * RELATORIO_VARIANTE_<letra>_* / COMPARATIVO_* e nunca se for (ou apontar
 * para) BASELINE.md.
 */
export async function gravarRelatorioSeguro(dir, nome, conteudo) {
  const alvo = path.resolve(ROOT, dir, nome);
  if (path.basename(alvo).toUpperCase() === ARQUIVO_IMUTAVEL.toUpperCase()) {
    throw new Error(`recusei gravar em ${nome}: ${ARQUIVO_IMUTAVEL} e imutavel`);
  }
  if (!PADRAO_RELATORIO.test(path.basename(alvo))) {
    throw new Error(`nome de relatorio fora do padrao RELATORIO_VARIANTE_*/COMPARATIVO_*: ${nome}`);
  }
  await mkdir(path.dirname(alvo), { recursive: true });
  await writeFile(alvo, conteudo, "utf8");
  return alvo;
}

// ---------------------------------------------------------------------------
// Relatorios (Markdown)
// ---------------------------------------------------------------------------

const pct = (n) => (Number.isFinite(n) ? `${Math.round(n * 100)}%` : "—");
const num = (n, casas = 2) => (Number.isFinite(n) ? arredondar(n, casas) : "—");
/** Escapa `|` para celulas de tabela Markdown (ex.: modo "deteccao|eventos"). */
const celula = (texto) => String(texto).replace(/\|/g, "\\|");

function linhaConfiguracao(v) {
  return [
    `imagens: ${v.imagens}`,
    `percepção local: ${v.percepcaoLocal ? "sim" : "não"}`,
    `dados locais no multimodal: ${v.dadosLocais ? "sim" : "não"}`,
    `temporal: ${v.temporal}`,
  ].join(" | ");
}

function tabelaDesempenho(desempenho) {
  if (!desempenho || !desempenho.ciclos) return ["_Sem registros em `logs/ciclos.jsonl` para esta variante._", ""];
  const linhas = [
    "| Etapa | Mediana (ms) | P95 (ms) | Amostras |",
    "|-------|-------------:|---------:|---------:|",
  ];
  const nomes = {
    capturaMs: "captura",
    deteccaoMs: "detecção",
    poseMs: "pose",
    maosMs: "mãos",
    temporalMs: "temporal",
    multimodalMs: "multimodal",
    persistenciaMs: "persistência",
    totalMs: "TOTAL do ciclo",
  };
  for (const etapa of ETAPAS_MS) {
    const m = desempenho.metricas[etapa];
    linhas.push(`| ${nomes[etapa]} | ${m.medianaMs ?? "—"} | ${m.p95Ms ?? "—"} | ${m.amostras} |`);
  }
  linhas.push("");
  const erros = Object.entries(desempenho.errosPorEtapa)
    .map(([e, q]) => `${e}: ${q}`)
    .join(", ");
  linhas.push(
    `- Ciclos: **${desempenho.ciclos}** (mediana de ${desempenho.framesPorCiclo ?? "—"} frames/ciclo) · ` +
      `**concluídos: ${desempenho.ciclosConcluidos}** · observações: ${desempenho.observacoes} · eventos temporais: ${desempenho.eventosTemporais}`
  );
  linhas.push(
    `- Ciclos com erro: **${desempenho.ciclosComErro}**${erros ? ` (${erros})` : ""} · cancelados: **${desempenho.cancelados}**`
  );
  const subs = Object.entries(desempenho.subsistemasIndisponiveis)
    .map(([s, q]) => `${s}: ${q}`)
    .join(", ");
  linhas.push(`- Subsistemas indisponíveis: ${subs || "nenhum"}`);
  linhas.push("");
  return linhas;
}

function tabelaQualidade(qualidade) {
  if (!qualidade || !qualidade.porClip?.length) return ["_Sem avaliação de qualidade (sem anotações ou sem arquivo de eventos)._", ""];
  const linhas = [
    "| Clipe | Precisão | Recall | F1 | FP/min | Não detectados | Dist. média casamento |",
    "|-------|---------:|-------:|---:|-------:|---------------:|----------------------:|",
  ];
  for (const p of qualidade.porClip) {
    if (p.pulado) {
      linhas.push(`| ${p.clipe} | pulado | pulado | pulado | pulado | pulado | ${p.motivo} |`);
      continue;
    }
    linhas.push(
      `| ${p.clipe} | ${pct(p.precisao)} | ${pct(p.recall)} | ${pct(p.f1)} | ${num(p.falsosPositivosPorMinuto)} | ${p.perdidos} | ${p.distanciaMediaMs ?? "—"} ms |`
    );
  }
  linhas.push("");
  const c = qualidade.consolidado;
  if (c) {
    linhas.push(
      `**Consolidado (${c.clipes} clipe(s))**: precisão ${pct(c.precisao)} · recall ${pct(c.recall)} · ` +
        `F1 ${pct(c.f1)} · FP/min ${num(c.falsosPositivosPorMinuto)} · não detectados ${c.eventosNaoDetectados} · ` +
        `distância média de casamento ${c.distanciaMediaMs ?? "—"} ms`
    );
    linhas.push("");
  }
  return linhas;
}

/** Linha de versao do codigo (commit/branch) para os relatorios. */
function linhaCodigo(ambiente) {
  const c = ambiente.codigo;
  if (!c?.commit) return "indisponível (fora de um repositório Git)";
  return `${c.branch || "?"} @ ${c.commit.slice(0, 12)}${c.alteracoesLocais ? " (alterações locais)" : " (limpo)"}`;
}

/** Clipes com hash — prova de que todas as variantes usaram os mesmos bytes. */
function linhaClipes(clipes) {
  if (!clipes.length) return "(nenhum)";
  return clipes
    .map((c) => {
      const hash = c.sha256 ? `sha256:${c.sha256.slice(0, 12)}…` : "sem hash";
      const bytes = Number.isFinite(c.tamanhoBytes) ? `${c.tamanhoBytes} bytes` : "tamanho ?";
      return `${c.nome} (${hash}, ${bytes}, anotação: ${c.anotacao ?? "ausente"})`;
    })
    .join("; ");
}

function gerarRelatorioVariante({
  variante,
  clipes,
  desempenho,
  coldStart,
  warmups = 0,
  etapasIsoladas,
  qualidade,
  arquivoEventos,
  arquivoCiclos,
  modelos,
  modelo,
  gate,
  ambiente,
  avisos,
  data,
}) {
  const observados = modelos?.visao?.length ? `visao.jsonl [${modelos.visao.join(", ")}]` : null;
  const deteccao = modelos?.deteccao?.length ? modelos.deteccao.join(", ") : null;
  const L = [
    `# Relatório da variante ${variante.letra} — ${data}`,
    "",
    `- **Variante:** ${variante.rotulo}`,
    `- **Modo no app:** \`${variante.modo}\``,
    `- **Configuração:** ${linhaConfiguracao(variante)}`,
    `- **Objetivo:** ${variante.objetivo}`,
    `- **Código:** ${linhaCodigo(ambiente)}`,
    `- **Backend multimodal:** ${ambiente.backend ?? "(não informado)"}`,
    `- **Janela da execução:** ${ambiente.inicioEm ?? "?"} → ${ambiente.fimEm ?? "?"}` +
      `${Number.isFinite(ambiente.duracaoMs) ? ` (${(ambiente.duracaoMs / 1000).toFixed(1)} s)` : ""}`,
    `- **Conjunto reservado:** ${ambiente.conjunto ?? "(não informado — use --conjunto <nome>)"}`,
    `- **Clipes (mesmos para todas as variantes):** ${linhaClipes(clipes)}`,
    `- **Modelo multimodal (registrado):** ${modelo || "(não informado — use --modelo-visao para registrar a versão usada)"}`,
    `- **Modelo multimodal (observado em visao.jsonl):** ${observados || "(sem campo `modelo` para os frames dos ciclos — não verificável)"}`,
    `- **Detector local (observado nos eventos):** ${deteccao || "(sem campo `modelo` nos eventos)"} — não é o modelo multimodal`,
    `- **Ciclos:** \`${arquivoCiclos}\` · **Eventos:** \`${arquivoEventos ?? "(nenhum arquivo)"}\``,
    `- **Tolerância de casamento:** ${argsTolerancia} ms`,
    `- **Warm-up:** ${warmups} ciclo(s) concluído(s) excluído(s) das medianas (parâmetro \`--warmups\`)`,
    `- **Ambiente:** ${ambiente.cpu} · ${ambiente.nucleosLogicos} núcleos · ${arredondar(ambiente.memoriaTotalBytes / 1024 ** 3, 1)} GB RAM · ${ambiente.plataforma} · Node ${ambiente.node}`,
    `- Gerado por \`scripts/benchmark-variantes.mjs\` em ${ambiente.dataHora}. Este arquivo não substitui \`bench/BASELINE.md\`.`,
    "",
    "## 1. Desempenho (logs/ciclos.jsonl, regime aquecido)",
    "",
    ...tabelaDesempenho(desempenho),
  ];

  if (coldStart) {
    L.push("## 1b. Cold start (primeiro(s) ciclo(s), fora das medianas)", "");
    L.push(
      `Os **${warmups}** primeiro(s) ciclo(s) concluído(s) foram tratados como aquecimento ` +
        "(compilação/carga de modelo). Mediana do ciclo completo no cold start: " +
        `**${coldStart.metricas.totalMs.medianaMs ?? "—"} ms** · detecção ${coldStart.metricas.deteccaoMs.medianaMs ?? "—"} ms · ` +
        `multimodal ${coldStart.metricas.multimodalMs.medianaMs ?? "—"} ms. ` +
        "O regime aquecido é o que vale para decidir arquitetura; o cold start mede o custo de partida.",
      ""
    );
  }

  if (etapasIsoladas) {
    L.push("## 1c. Etapas isoladas × ciclo completo", "");
    L.push(
      "| Etapa | Mediana (ms) | P95 (ms) | Máximo (ms) | Cobertura |",
      "|-------|-------------:|---------:|------------:|----------:|"
    );
    const nomesLocais = {
      capturaMs: "captura",
      deteccaoMs: "detecção",
      poseMs: "pose",
      maosMs: "mãos",
      temporalMs: "temporal",
    };
    for (const e of etapasIsoladas.etapas) {
      L.push(
        `| ${nomesLocais[e.etapa] ?? e.etapa} | ${e.medianaMs ?? "—"} | ${e.p95Ms ?? "—"} | ${e.maximoMs ?? "—"} | ${e.cobertura === null ? "—" : pct(e.cobertura)} |`
      );
    }
    L.push("");
    L.push(
      `- **Soma local (mediana por ciclo):** ${etapasIsoladas.somaLocalMedianaMs ?? "—"} ms · ` +
        `**ciclo completo (mediana):** ${etapasIsoladas.totalMedianaMs ?? "—"} ms · ` +
        `**multimodal (mediana):** ${etapasIsoladas.multimodalMedianaMs ?? "—"} ms`
    );
    L.push(
      `- **Etapas sem amostra (nenhum ciclo registrou):** ${etapasIsoladas.ausentes.join(", ") || "nenhuma"}`
    );
    L.push(
      "- Cada etapa local é medida por si só e depois somada no ciclo; a diferença para o ciclo completo é o multimodal e a persistência."
    );
    L.push("");
  }

  L.push(
    "## 2. Qualidade (npm run qualidade por clipe)",
    "",
    ...tabelaQualidade(qualidade)
  );

  if (gate && !ambiente.semQualidade) {
    L.push("## 2b. Gate de qualidade × latência", "");
    L.push(
      `Critérios: F1 ≥ ${pct(gate.criterios?.minF1 ?? 0.5)} · FP/min ≤ ${num(gate.criterios?.maxFpMin ?? 2)} · ` +
        `ganho de F1 ≥ ${pct(gate.criterios?.ganhoMinimoF1 ?? 0.1)} sobre a referência · ` +
        `latência ≤ ${num(gate.criterios?.custoMaximoLatencia ?? 1.5)}× a referência.`
    );
    L.push("");
    L.push(
      `- **Veredito:** ${gate.promovivel ? "✅ **promovível a padrão**" : "⚠️ **manter experimental**"}`
    );
    if (gate.ganhoF1 !== null) L.push(`- Ganho de F1 sobre a referência: ${pctCurto(gate.ganhoF1)}`);
    if (gate.taxaCusto !== null) L.push(`- Latência total: ${num(gate.taxaCusto)}× a referência`);
    if (gate.motivo) L.push(`- ${gate.motivo}`);
    L.push("");
  }

  L.push(
    "## 3. Observações",
    "",
    ...(avisos.length ? avisos.map((a) => `- ⚠️ ${a}`) : ["- Nenhuma."]),
    ""
  );
  return L.join("\n");
}

let argsTolerancia = 3000; // preenchido em main() para os relatorios

function gerarComparativo({ variantes, resultados, clipes, modelo, verificacaoModelo, comparabilidade, gateQualidade, ambiente, data, avisos }) {
  const nomeConjunto = LETRAS.filter((l) => variantes.some((v) => v.letra === l)).join("_");
  const L = [
    `# Comparativo arquitetural ${nomeConjunto.split("_").join(" × ")} — ${data}`,
    "",
    `- **Veredito:** ${comparabilidade.conclusivo ? "✅ **conclusivo** — dados comparáveis" : "⚠️ **INCONCLUSIVO** — não use os números para decidir entre variantes"}`,
    `- **Conjunto reservado:** ${ambiente.conjunto ?? "(não informado — use --conjunto <nome>)"}`,
    `- **Warm-up excluído das medianas:** ${ambiente.warmups ?? 0} ciclo(s) concluído(s) por variante`,
    `- **Clipes (idênticos em todas as variantes):** ${linhaClipes(clipes)}`,
    `- **Modelo multimodal (registrado):** ${modelo || "(não informado)"}`,
    `- **Código:** ${linhaCodigo(ambiente)}`,
    `- **Backend multimodal:** ${ambiente.backend ?? "(não informado)"}`,
    `- **Hardware:** ${ambiente.cpu} · ${ambiente.nucleosLogicos} núcleos · ${arredondar(ambiente.memoriaTotalBytes / 1024 ** 3, 1)} GB RAM · ${ambiente.plataforma} · Node ${ambiente.node}`,
    `- **Janela da execução:** ${ambiente.inicioEm ?? "?"} → ${ambiente.fimEm ?? "?"}` +
      `${Number.isFinite(ambiente.duracaoMs) ? ` (${(ambiente.duracaoMs / 1000).toFixed(1)} s)` : ""}`,
    `- **Critério de conclusão:** ao menos ${ambiente.minCiclosValidos ?? 1} ciclo(s) concluído(s) por variante **no regime aquecido**, modelo multimodal verificado em \`logs/visao.jsonl\` e um arquivo de eventos próprio por variante.`,
    `- Gerado em ${ambiente.dataHora}. O \`bench/BASELINE.md\` permanece intocado.`,
    "",
  ];

  if (!comparabilidade.conclusivo) {
    L.push("## Por que este comparativo é inconclusivo", "");
    for (const p of comparabilidade.problemas) L.push(`- ⚠️ ${p}`);
    L.push("");
  }

  L.push(
    "## Matriz de configuração",
    "",
    "| Variante | Modo | Imagens | Percepção local | Dados locais | Temporal | Objetivo |",
    "|----------|------|--------:|:---------------:|:------------:|----------|----------|"
  );
  for (const v of variantes) {
    L.push(
      `| ${v.letra} | \`${celula(v.modo)}\` | ${v.imagens} | ${v.percepcaoLocal ? "sim" : "não"} | ${v.dadosLocais ? "sim" : "não"} | ${v.temporal} | ${v.objetivo} |`
    );
  }
  L.push("");

  L.push("## Desempenho (mediana / P95 por variante, regime aquecido)", "");
  L.push(
    "| Variante | Ciclos | Concluídos | Warm-ups | Cold start total (ms) | Total med (ms) | Total P95 (ms) | Multimodal med (ms) | Temporal med (ms) | Deteccão med (ms) | Erros | Cancelados |",
    "|----------|-------:|-----------:|---------:|----------------------:|---------------:|---------------:|--------------------:|------------------:|------------------:|------:|-----------:|"
  );
  for (const { variante, desempenho, desempenhoAquecido, coldStart, warmups } of resultados) {
    const valido = desempenhoAquecido ?? desempenho;
    const m = valido?.metricas ?? {};
    L.push(
      `| ${variante.letra} | ${valido?.ciclos ?? 0} | ${valido?.ciclosConcluidos ?? 0} | ${warmups ?? 0} | ${coldStart?.metricas.totalMs.medianaMs ?? "—"} | ${m.totalMs?.medianaMs ?? "—"} | ${m.totalMs?.p95Ms ?? "—"} | ${m.multimodalMs?.medianaMs ?? "—"} | ${m.temporalMs?.medianaMs ?? "—"} | ${m.deteccaoMs?.medianaMs ?? "—"} | ${valido?.ciclosComErro ?? 0} | ${valido?.cancelados ?? 0} |`
    );
  }
  L.push("");

  // Etapas isoladas x ciclo completo (somente quando solicitado por variante).
  const comEtapas = resultados.filter((r) => r.etapasIsoladas);
  if (comEtapas.length) {
    L.push("## Etapas isoladas × ciclo completo (mediana por ciclo)", "");
    L.push(
      "| Variante | Soma local (ms) | Ciclo completo (ms) | Multimodal (ms) | Etapas sem amostra |",
      "|----------|----------------:|--------------------:|----------------:|--------------------|"
    );
    for (const { variante, etapasIsoladas } of comEtapas) {
      L.push(
        `| ${variante.letra} | ${etapasIsoladas.somaLocalMedianaMs ?? "—"} | ${etapasIsoladas.totalMedianaMs ?? "—"} | ${etapasIsoladas.multimodalMedianaMs ?? "—"} | ${etapasIsoladas.ausentes.join(", ") || "nenhuma"} |`
      );
    }
    L.push("");
  }

  L.push("## Qualidade (consolidado por variante)", "");
  L.push(
    "| Variante | Precisão | Recall | F1 | FP/min | Não detectados | Dist. média casamento |",
    "|----------|---------:|-------:|---:|-------:|---------------:|----------------------:|"
  );
  for (const { variante, qualidade } of resultados) {
    const c = qualidade?.consolidado;
    if (!c) {
      L.push(`| ${variante.letra} | — | — | — | — | — | sem avaliação |`);
      continue;
    }
    L.push(
      `| ${variante.letra} | ${pct(c.precisao)} | ${pct(c.recall)} | ${pct(c.f1)} | ${num(c.falsosPositivosPorMinuto)} | ${c.eventosNaoDetectados} | ${c.distanciaMediaMs ?? "—"} ms |`
    );
  }
  L.push("");

  // Gate de qualidade x latencia (Fase 5, itens 5 e 6): decide se C/D podem ser
  // promovidas a padrao ou devem permanecer experimentais com estes dados.
  if (gateQualidade && !ambiente.semQualidade) {
    const c = gateQualidade.criterios;
    L.push("## Gate de qualidade × latência (decisão de promoção)", "");
    L.push(
      `Critérios definidos previamente: **F1 ≥ ${pct(c.minF1)}** · **FP/min ≤ ${num(c.maxFpMin)}** · ` +
        `**ganho de F1 ≥ ${pct(c.ganhoMinimoF1)}** sobre a referência (${gateQualidade.referencia.letra ?? "n/d"}) · ` +
        `**latência ≤ ${num(c.custoMaximoLatencia)}×** a referência.`
    );
    L.push("");
    L.push(
      "| Variante | F1 | FP/min | Ganho F1 vs ref | Latência vs ref | Qualidade | Compensa | Recomendação |",
      "|----------|----|-------:|----------------:|----------------:|:---------:|:--------:|--------------|"
    );
    for (const g of gateQualidade.porVariante) {
      L.push(
        `| ${g.letra} | ${g.f1 === null ? "—" : pct(g.f1)} | ${g.falsosPositivosPorMinuto === null ? "—" : num(g.falsosPositivosPorMinuto)} | ` +
          `${g.ganhoF1 === null ? "—" : pctCurto(g.ganhoF1)} | ${g.taxaCusto === null ? "—" : `${num(g.taxaCusto)}×`} | ` +
          `${g.atende ? "✅" : "⚠️"} | ${g.compensa ? "✅" : "⚠️"} | ${g.promovivel ? "**promovível a padrão**" : "manter experimental"} |`
      );
    }
    L.push("");
    if (gateQualidade.experimentais.length) {
      L.push(
        `⚠️ **Manter experimentais com estes dados:** ${gateQualidade.experimentais.join(", ")}. ` +
          "Não promover a padrão sem nova medição que atenda aos critérios acima."
      );
    } else {
      L.push("✅ **Todas as variantes com dados atendem aos critérios.**");
    }
    L.push("");
  }

  // Lideres por criterio: SOMENTE quando o veredito e conclusivo. Em rodada
  // invalida, listar "vencedores" seria repetir o defeito do comparativo de
  // 2026-10-18 (metricas iguais copiadas entre variantes).
  if (!comparabilidade.conclusivo) {
    L.push("## Líderes por critério", "");
    L.push("_Não há líderes: a rodada não atende ao critério de conclusão (ver problemas acima)._");
    L.push("");
  } else {
    const comQualidade = resultados.filter((r) => r.qualidade?.consolidado);
    const comDesempenho = resultados.filter(
      (r) => ((r.desempenhoAquecido ?? r.desempenho)?.ciclosConcluidos ?? 0) > 0
    );
    const desempenhoDe = (r) => r.desempenhoAquecido ?? r.desempenho ?? { metricas: {} };
    const melhor = (lista, fn) => lista.reduce((best, r) => (best === null || fn(r) > fn(best) ? r : best), null);
    const pior = (lista, fn) => lista.reduce((worst, r) => (worst === null || fn(r) < fn(worst) ? r : worst), null);

    L.push("## Líderes por critério (entre variantes com dados)", "");
    if (comQualidade.length) {
      const bF1 = melhor(comQualidade, (r) => r.qualidade.consolidado.f1);
      const bRecall = melhor(comQualidade, (r) => r.qualidade.consolidado.recall);
      const bPrec = melhor(comQualidade, (r) => r.qualidade.consolidado.precisao);
      const bFp = pior(comQualidade, (r) => r.qualidade.consolidado.falsosPositivosPorMinuto);
      const bLat = pior(comQualidade, (r) => r.qualidade.consolidado.distanciaMediaMs ?? Infinity);
      L.push(`- **Maior F1:** ${bF1.variante.letra} (${pct(bF1.qualidade.consolidado.f1)})`);
      L.push(`- **Maior recall:** ${bRecall.variante.letra} (${pct(bRecall.qualidade.consolidado.recall)})`);
      L.push(`- **Maior precisão:** ${bPrec.variante.letra} (${pct(bPrec.qualidade.consolidado.precisao)})`);
      L.push(`- **Menos FP/min:** ${bFp.variante.letra} (${num(bFp.qualidade.consolidado.falsosPositivosPorMinuto)})`);
      L.push(
        `- **Casamento mais próximo do instante real:** ${bLat.variante.letra} (${bLat.qualidade.consolidado.distanciaMediaMs ?? "—"} ms)`
      );
    } else {
      L.push("_Sem dados de qualidade para comparar._");
    }
    if (comDesempenho.length) {
      const bTotal = pior(comDesempenho, (r) => desempenhoDe(r).metricas.totalMs.medianaMs ?? Infinity);
      const bMulti = pior(comDesempenho, (r) => desempenhoDe(r).metricas.multimodalMs.medianaMs ?? Infinity);
      const bErros = pior(comDesempenho, (r) => desempenhoDe(r).ciclosComErro + desempenhoDe(r).cancelados);
      L.push(`- **Menor latência total do ciclo (mediana):** ${bTotal.variante.letra} (${desempenhoDe(bTotal).metricas.totalMs.medianaMs ?? "—"} ms)`);
      L.push(`- **Menor latência multimodal (mediana):** ${bMulti.variante.letra} (${desempenhoDe(bMulti).metricas.multimodalMs.medianaMs ?? "—"} ms)`);
      L.push(`- **Mais robusta (erros + cancelamentos):** ${bErros.variante.letra} (${desempenhoDe(bErros).ciclosComErro + desempenhoDe(bErros).cancelados})`);
    } else {
      L.push("_Sem dados de desempenho para comparar._");
    }
    L.push("");
  }

  // Garantia de mesmo modelo multimodal: SOMENTE visao.jsonl (frameId dos
  // ciclos). O `modelo` dos eventos e o detector local e nao prova nada sobre
  // o multimodal — por isso aparece em coluna separada, apenas informativa.
  L.push("## Modelo multimodal verificado", "");
  if (verificacaoModelo?.modelos?.length) {
    L.push(`Modelos distintos observados em todas as variantes: \`${verificacaoModelo.modelos.join("`, `")}\``);
    L.push("");
  }
  L.push(
    "| Variante | Modelo(s) multimodal em visao.jsonl | Detector local nos eventos (não é o multimodal) |",
    "|----------|--------------------------------------|--------------------------------------------------|"
  );
  for (const { variante, modelos } of resultados) {
    const vis = (modelos?.visao ?? []).join(", ") || "—";
    const det = (modelos?.deteccao ?? []).join(", ") || "—";
    L.push(`| ${variante.letra} | ${vis} | ${det} |`);
  }
  L.push("");
  if (verificacaoModelo?.consistente && verificacaoModelo?.modelos?.length) {
    L.push("✅ **Mesmo modelo multimodal confirmado para todas as variantes com dados.**");
  } else {
    L.push("⚠️ **Mesmo modelo multimodal NÃO confirmado** — ver problemas/avisos.");
  }
  L.push("");

  L.push("## Cuidados de comparação", "");
  L.push("- Todos os números acima derivam do **mesmo conjunto de clipes**; a variação entre execuções vem do modelo e do hardware, não dos clipes.");
  L.push(
    `- **Conjunto reservado:** ${ambiente.conjunto ?? "não informado (use --conjunto <nome>)"} — o conjunto de avaliação final deve ser separado do conjunto de ajuste (tuning).`
  );
  L.push(
    `- **Warm-up:** ${ambiente.warmups ?? 0} ciclo(s) concluído(s) por variante foram excluídos das medianas; compare no campo "Cold start" o custo de partida.`
  );
  if (modelo) {
    L.push(`- Modelo multimodal registrado: \`${modelo}\`. Confirme no app que **todas** as variantes rodaram com esta versão.`);
  } else {
    L.push("- ⚠️ Nenhuma versão de modelo foi registrada (`--modelo-visao`); valide manualmente que todas as variantes usaram o mesmo modelo.");
  }
  if (avisos.length) {
    L.push("- Avisos desta rodada:");
    for (const a of avisos) L.push(`  - ⚠️ ${a}`);
  }
  L.push("- Este comparativo é um artefato novo (`COMPARATIVO_*`); `bench/BASELINE.md` não é alterado por este script.");
  L.push("");
  return { conteudo: L.join("\n"), nome: `COMPARATIVO_${nomeConjunto}_${data}.md` };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/** URL do backend sem credenciais, para relatorios versionaveis. */
function backendSeguro(valor) {
  if (!valor) return "http://localhost:1234 (padrao do servidor)";
  try {
    const url = new URL(valor);
    url.username = "";
    url.password = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return String(valor);
  }
}

async function main() {
  const args = lerArgs();
  if (args.help) {
    console.log(USO);
    return;
  }
  argsTolerancia = args.tolerancia;
  const data = args.data || dataHoraCurta();
  const ambiente = montarAmbiente();
  const avisos = [];
  const inicioEm = new Date().toISOString();
  const inicioMs = Date.now();
  const backend = backendSeguro(process.env.NEURO_BASE_URL);
  Object.assign(ambiente, {
    inicioEm,
    backend,
    minCiclosValidos: args.minCiclos,
    warmups: args.warmups,
    etapasIsoladas: args.etapasIsoladas,
    conjunto: args.conjunto,
    criteriosQualidade: args.criteriosQualidade,
    semQualidade: args.semQualidade,
  });

  const variantes = VARIANTES_BENCHMARK.filter((v) => args.variantes.includes(v.letra));
  const modeloGlobal = args.modeloVisao ?? process.env.NEURO_MODELO_VISAO ?? "";

  const clipes = await descobrirClipes(args.clipesDir, args.clipes, args.anotacoesDir);
  if (!clipes.length) {
    console.error(
      `ERRO: nenhum clipe encontrado em ${args.clipesDir || args.clipes.join(", ")}. Use --clipes-dir ou --clipes.`
    );
    process.exit(1);
  }

  console.log(`Clipes (${clipes.length}): ${clipes.map((c) => c.nome).join(", ")}`);
  const semAnotacao = clipes.filter((c) => !c.anotacao);
  if (semAnotacao.length) {
    avisos.push(`sem anotação (<clipe>.json) para: ${semAnotacao.map((c) => c.nome).join(", ")} — qualidade parcial`);
    console.log(`ATENCAO: sem anotacao para ${semAnotacao.map((c) => c.nome).join(", ")}`);
  }
  console.log(`Variantes: ${variantes.map((v) => v.letra).join(", ")} | modelo: ${modeloGlobal || "(nao informado)"}\n`);

  const resultados = [];
  for (const variante of variantes) {
    console.log(`== Variante ${variante.letra} — ${variante.rotulo} ==`);

    // 1. Desempenho a partir de logs/ciclos.jsonl.
    const arquivoCiclos = await resolverArquivoCiclos(variante, args);
    const { registros, encontrado } = await lerCiclos(arquivoCiclos);
    const daVariante = filtrarCiclosDaVariante(registros, variante.letra, args.sessoesPorVariante[variante.letra]);
    let desempenho = null;
    if (!encontrado) {
      avisos.push(`${variante.letra}: arquivo de ciclos nao encontrado (${arquivoCiclos})`);
      console.log(`  ciclos: ${arquivoCiclos} nao encontrado`);
    } else if (!daVariante.length) {
      avisos.push(
        `${variante.letra}: nenhum ciclo em ${arquivoCiclos} corresponde a esta variante (use --sessao-${variante.letra} <sessionId> ou grave logs com o modo ${variante.modo})`
      );
      console.log(`  ciclos: 0 registros correspondentes em ${arquivoCiclos}`);
    } else {
      desempenho = agregarMetricasCiclos(daVariante);
      console.log(
        `  ciclos: ${desempenho.ciclos} registros (${desempenho.ciclosConcluidos} concluidos) | total mediana ${desempenho.metricas.totalMs.medianaMs ?? "-"} ms | erros ${desempenho.ciclosComErro} | cancelados ${desempenho.cancelados}`
      );
    }

    // 1b. Warm-up x regime aquecido (Fase 5, item 2). Os primeiros `--warmups`
    //     ciclos concluidos sao aquecimento (compilacao/carga de modelo) e ficam
    //     fora das medianas do comparativo; o cold start e medido a parte.
    const { warmup, aquecido } = separarWarmupCiclos(daVariante, args.warmups);
    const desempenhoAquecido = warmup.length ? agregarMetricasCiclos(aquecido) : desempenho;
    const coldStart = warmup.length ? agregarMetricasCiclos(warmup) : null;
    if (warmup.length) {
      console.log(
        `  warm-up: ${warmup.length} ciclo(s) fora das medianas (cold start total ${coldStart.metricas.totalMs.medianaMs ?? "-"} ms) | aquecido ${desempenhoAquecido.ciclosConcluidos} concluido(s)`
      );
    }

    // 1c. Etapas isoladas x ciclo completo (Fase 5, item 3). Deriva das MESMAS
    //     metricas reais; exige `--etapas-isoladas` para entrar no relatorio.
    const etapasIsoladas = args.etapasIsoladas ? agregarEtapasIsoladas(aquecido) : null;
    if (etapasIsoladas) {
      console.log(
        `  etapas isoladas: soma local mediana ${etapasIsoladas.somaLocalMedianaMs ?? "-"} ms | ciclo completo ${etapasIsoladas.totalMedianaMs ?? "-"} ms | ausentes: ${etapasIsoladas.ausentes.join(", ") || "nenhuma"}`
      );
    }

    // 2. Versao do modelo observada NESTA variante. `--modelo-visao` apenas
    //    registra a intencao; o campo `modelo` de visao.jsonl (por frameId do
    //    ciclo) prova o que rodou. O `modelo` dos eventos e o detector local.
    const arquivoEventos = await resolverArquivoEventos(variante, args);
    const frameIds = daVariante.flatMap((r) => (Array.isArray(r.frameIds) ? r.frameIds : []));
    const modelos = {
      visao: await modelosDosFrames(args.visao, frameIds),
      // Modelo do detector local: informativo, NAO entra na prova do multimodal.
      deteccao: arquivoEventos ? await extrairModelosDoJsonl(arquivoEventos) : [],
    };
    const resumoModelos = [
      modelos.visao.length ? `visao.jsonl [${modelos.visao.join(", ")}]` : null,
      modelos.deteccao.length ? `detector local [${modelos.deteccao.join(", ")}]` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    console.log(`  modelo observado: ${resumoModelos || "(sem campo `modelo` nos logs desta variante)"}`);

    // 3. Qualidade por clipe via npm run qualidade (scripts/avaliar-qualidade.mjs).
    let qualidade = null;
    if (args.semQualidade) {
      console.log("  qualidade: pulada (--sem-qualidade)");
    } else {
      if (!arquivoEventos) {
        avisos.push(
          `${variante.letra}: nenhum arquivo de eventos encontrado (esperado ${args.eventosPorVariante[variante.letra] ?? `logs/eventos-${variante.letra}.jsonl`}, ${args.eventos}) — rode o app sobre o clipe com esta variante antes de avaliar`
        );
        console.log("  qualidade: sem arquivo de eventos");
      } else {
        console.log(`  qualidade: avaliando ${clipes.length} clipe(s) contra ${arquivoEventos}...`);
        qualidade = await avaliarQualidadeDaVariante(variante, clipes, arquivoEventos, args);
        const c = qualidade.consolidado;
        if (c) {
          console.log(
            `  qualidade: F1 ${pct(c.f1)} | precisao ${pct(c.precisao)} | recall ${pct(c.recall)} | FP/min ${num(c.falsosPositivosPorMinuto)} | nao detectados ${c.eventosNaoDetectados}`
          );
        } else {
          avisos.push(`${variante.letra}: qualidade nao concluiu (sem anotacoes validas ou eventos ilegiveis)`);
          console.log("  qualidade: sem resultado consolidado");
        }
      }
    }

    resultados.push({
      variante,
      desempenho,
      desempenhoAquecido,
      coldStart,
      warmups: warmup.length,
      etapasIsoladas,
      qualidade,
      arquivoEventos,
      arquivoCiclos,
      modelos,
      registros: daVariante,
      sessaoExplicita: Boolean(args.sessoesPorVariante[variante.letra]),
    });
    console.log("");
  }

  // Garantia de mesmo modelo multimodal em todas as variantes (item [1]).
  // Os avisos entram no veredito de comparabilidade abaixo (evita duplicacao).
  const verificacaoModelo = verificarMesmoModelo(resultados, modeloGlobal);

  // 3. Veredito de comparabilidade ANTES de gravar: uma rodada sem ciclos
  //    concluidos, sem modelo verificado ou com eventos compartilhados nao pode
  //    produzir conclusao. Com --warmups, a contagem usa o regime AQUECIDO: o
  //    aquecimento nao vale como amostra para decidir arquitetura.
  const comparabilidade = avaliarComparabilidade(resultados, {
    modeloGlobal,
    minCiclosValidos: args.minCiclos,
    exigirQualidade: !args.semQualidade,
  });
  for (const p of comparabilidade.problemas) avisos.push(`comparabilidade: ${p}`);

  // 3b. Gate de qualidade x latencia (Fase 5, itens 5 e 6). Independente do
  //     veredito de comparabilidade: diz se C/D podem ser promovidas a padrao
  //     ou devem permanecer experimentais com estes dados.
  const gateQualidade = avaliarGateQualidade(resultados, args.criteriosQualidade);
  if (!args.semQualidade) {
    for (const g of gateQualidade.porVariante) {
      console.log(
        `  gate ${g.letra}: ${g.promovivel ? "PROMOVIVEL a padrao" : "manter experimental"}${g.motivo ? ` — ${g.motivo}` : ""}`
      );
    }
  }

  const fimEm = new Date().toISOString();
  const duracaoMs = Date.now() - inicioMs;
  Object.assign(ambiente, { fimEm, duracaoMs });

  // 4. Relatorios por variante + consolidado.
  const gravados = [];
  if (!args.semRelatorio) {
    for (const result of resultados) {
      const { variante, qualidade, arquivoEventos, arquivoCiclos, modelos } = result;
      const avisosDaVariante = [
        ...new Set([
          ...avisos.filter((a) => a.startsWith(`${variante.letra}:`)),
          ...comparabilidade.problemas.filter((p) => p.startsWith(`${variante.letra}:`)),
        ]),
      ];
      const conteudo = gerarRelatorioVariante({
        variante,
        clipes,
        desempenho: result.desempenhoAquecido ?? result.desempenho,
        coldStart: result.coldStart,
        warmups: result.warmups,
        etapasIsoladas: result.etapasIsoladas,
        qualidade,
        arquivoEventos,
        arquivoCiclos,
        modelos,
        modelo: args.modeloPorVariante[variante.letra] ?? modeloGlobal,
        gate: gateQualidade.porVariante.find((g) => g.letra === variante.letra) ?? null,
        ambiente,
        avisos: avisosDaVariante,
        data,
      });
      const alvo = await gravarRelatorioSeguro(args.saida, `RELATORIO_VARIANTE_${variante.letra}_${data}.md`, conteudo);
      gravados.push(alvo);
      console.log(`Relatorio gravado: ${path.relative(ROOT, alvo)}`);
    }

    if (comparabilidade.conclusivo || args.permitirInconclusivo) {
      const cmp = gerarComparativo({
        variantes,
        resultados,
        clipes,
        modelo: modeloGlobal,
        verificacaoModelo,
        comparabilidade,
        gateQualidade,
        ambiente,
        data,
        avisos,
      });
      const alvoCmp = await gravarRelatorioSeguro(args.saida, cmp.nome, cmp.conteudo);
      gravados.push(alvoCmp);
      console.log(`Comparativo gravado: ${path.relative(ROOT, alvoCmp)}\n`);
    } else {
      console.log(
        "Comparativo NAO gravado: a rodada nao atende ao criterio de comparabilidade " +
          "(use --permitir-inconclusivo para gravar um diagnostico marcado como INCONCLUSIVO).\n"
      );
    }
  }

  // Resumo no console (compativel com qualquer shell).
  const letrasPromoviveis = new Set(gateQualidade.porVariante.filter((g) => g.promovivel).map((g) => g.letra));
  console.table(
    resultados.map(({ variante, desempenhoAquecido, desempenho, coldStart, warmups, qualidade, modelos }) => {
      const valido = desempenhoAquecido ?? desempenho;
      const m = valido?.metricas ?? {};
      const c = qualidade?.consolidado;
      return {
        variante: variante.letra,
        modo: variante.modo,
        modelo: (modelos?.visao ?? []).join(", ") || "-",
        "detector local": (modelos?.deteccao ?? []).join(", ") || "-",
        ciclos: valido?.ciclos ?? 0,
        concluidos: valido?.ciclosConcluidos ?? 0,
        warmups: warmups ?? 0,
        "cold start (ms)": coldStart?.metricas.totalMs.medianaMs ?? "-",
        "total med (ms)": m.totalMs?.medianaMs ?? "-",
        "total P95 (ms)": m.totalMs?.p95Ms ?? "-",
        "multimodal med (ms)": m.multimodalMs?.medianaMs ?? "-",
        F1: c ? pct(c.f1) : "-",
        precisao: c ? pct(c.precisao) : "-",
        recall: c ? pct(c.recall) : "-",
        "FP/min": c ? num(c.falsosPositivosPorMinuto) : "-",
        "nao detectados": c ? c.eventosNaoDetectados : "-",
        erros: valido?.ciclosComErro ?? 0,
        cancelados: valido?.cancelados ?? 0,
        gate: args.semQualidade ? "-" : letrasPromoviveis.has(variante.letra) ? "promovivel" : "experimental",
      };
    })
  );

  if (avisos.length) {
    console.log("\nAvisos:");
    for (const a of avisos) console.log(`  - ${a}`);
  }

  console.log(
    comparabilidade.conclusivo
      ? "\nVeredito: CONCLUSAO VALIDA — dados comparaveis."
      : "\nVeredito: INCONCLUSIVO — corrija os problemas acima antes de decidir entre variantes."
  );

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          ambiente,
          execucao: {
            inicioEm,
            fimEm,
            duracaoMs,
            backend,
            codigo: ambiente.codigo,
            minCiclosValidos: args.minCiclos,
            warmups: args.warmups,
            etapasIsoladas: args.etapasIsoladas,
            conjunto: args.conjunto,
            semQualidade: args.semQualidade,
          },
          data,
          clipes: clipes.map((c) => ({
            nome: c.nome,
            caminho: c.caminho,
            anotacao: c.anotacao,
            tamanhoBytes: c.tamanhoBytes,
            sha256: c.sha256,
          })),
          modelo: modeloGlobal || undefined,
          conclusivo: comparabilidade.conclusivo,
          comparabilidade,
          gateQualidade,
          gravados: gravados.map((g) => path.relative(ROOT, g)),
          avisos,
          resultados: resultados.map(
            ({
              variante,
              desempenho,
              desempenhoAquecido,
              coldStart,
              warmups,
              etapasIsoladas,
              qualidade,
              arquivoEventos,
              arquivoCiclos,
              modelos,
              sessaoExplicita,
            }) => ({
              variante: variante.letra,
              modo: variante.modo,
              configuracao: {
                imagens: variante.imagens,
                percepcaoLocal: variante.percepcaoLocal,
                dadosLocais: variante.dadosLocais,
                temporal: variante.temporal,
              },
              sessaoExplicita,
              arquivoCiclos,
              arquivoEventos,
              modelos,
              desempenho,
              desempenhoAquecido,
              coldStart,
              warmups,
              etapasIsoladas,
              gate: gateQualidade.porVariante.find((g) => g.letra === variante.letra) ?? null,
              qualidade,
            })
          ),
          verificacaoModelo,
        },
        null,
        2
      )
    );
  }

  if (!comparabilidade.conclusivo && !args.permitirInconclusivo) {
    process.exitCode = 1;
  }
}

const caminhoDoModulo = fileURLToPath(import.meta.url);
const executadoDiretamente =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === caminhoDoModulo;

if (executadoDiretamente) {
  main().catch((err) => {
    console.error(`ERRO: ${err.message}`);
    process.exit(1);
  });
}
