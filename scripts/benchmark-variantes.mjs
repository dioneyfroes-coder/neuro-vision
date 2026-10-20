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
    const concluidos = r.desempenho?.ciclosConcluidos ?? 0;
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
      ciclos: r.desempenho?.ciclos ?? 0,
      ciclosConcluidos: concluidos,
      cancelados: r.desempenho?.cancelados ?? 0,
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

function gerarRelatorioVariante({ variante, clipes, desempenho, qualidade, arquivoEventos, arquivoCiclos, modelos, modelo, ambiente, avisos, data }) {
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
    `- **Clipes (mesmos para todas as variantes):** ${linhaClipes(clipes)}`,
    `- **Modelo multimodal (registrado):** ${modelo || "(não informado — use --modelo-visao para registrar a versão usada)"}`,
    `- **Modelo multimodal (observado em visao.jsonl):** ${observados || "(sem campo `modelo` para os frames dos ciclos — não verificável)"}`,
    `- **Detector local (observado nos eventos):** ${deteccao || "(sem campo `modelo` nos eventos)"} — não é o modelo multimodal`,
    `- **Ciclos:** \`${arquivoCiclos}\` · **Eventos:** \`${arquivoEventos ?? "(nenhum arquivo)"}\``,
    `- **Tolerância de casamento:** ${argsTolerancia} ms`,
    `- **Ambiente:** ${ambiente.cpu} · ${ambiente.nucleosLogicos} núcleos · ${arredondar(ambiente.memoriaTotalBytes / 1024 ** 3, 1)} GB RAM · ${ambiente.plataforma} · Node ${ambiente.node}`,
    `- Gerado por \`scripts/benchmark-variantes.mjs\` em ${ambiente.dataHora}. Este arquivo não substitui \`bench/BASELINE.md\`.`,
    "",
    "## 1. Desempenho (logs/ciclos.jsonl)",
    "",
    ...tabelaDesempenho(desempenho),
    "## 2. Qualidade (npm run qualidade por clipe)",
    "",
    ...tabelaQualidade(qualidade),
    "## 3. Observações",
    "",
    ...(avisos.length ? avisos.map((a) => `- ⚠️ ${a}`) : ["- Nenhuma."]),
    "",
  ];
  return L.join("\n");
}

let argsTolerancia = 3000; // preenchido em main() para os relatorios

function gerarComparativo({ variantes, resultados, clipes, modelo, verificacaoModelo, comparabilidade, ambiente, data, avisos }) {
  const nomeConjunto = LETRAS.filter((l) => variantes.some((v) => v.letra === l)).join("_");
  const L = [
    `# Comparativo arquitetural ${nomeConjunto.split("_").join(" × ")} — ${data}`,
    "",
    `- **Veredito:** ${comparabilidade.conclusivo ? "✅ **conclusivo** — dados comparáveis" : "⚠️ **INCONCLUSIVO** — não use os números para decidir entre variantes"}`,
    `- **Clipes (idênticos em todas as variantes):** ${linhaClipes(clipes)}`,
    `- **Modelo multimodal (registrado):** ${modelo || "(não informado)"}`,
    `- **Código:** ${linhaCodigo(ambiente)}`,
    `- **Backend multimodal:** ${ambiente.backend ?? "(não informado)"}`,
    `- **Janela da execução:** ${ambiente.inicioEm ?? "?"} → ${ambiente.fimEm ?? "?"}` +
      `${Number.isFinite(ambiente.duracaoMs) ? ` (${(ambiente.duracaoMs / 1000).toFixed(1)} s)` : ""}`,
    `- **Critério de conclusão:** ao menos ${ambiente.minCiclosValidos ?? 1} ciclo(s) concluído(s) por variante, modelo multimodal verificado em \`logs/visao.jsonl\` e um arquivo de eventos próprio por variante.`,
    `- **Ambiente:** ${ambiente.cpu} · ${ambiente.nucleosLogicos} núcleos · ${arredondar(ambiente.memoriaTotalBytes / 1024 ** 3, 1)} GB RAM · ${ambiente.plataforma} · Node ${ambiente.node}`,
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

  L.push("## Desempenho (mediana / P95 por variante)", "");
  L.push(
    "| Variante | Ciclos | Concluídos | Total med (ms) | Total P95 (ms) | Multimodal med (ms) | Temporal med (ms) | Deteccão med (ms) | Erros | Cancelados |",
    "|----------|-------:|-----------:|---------------:|---------------:|--------------------:|------------------:|------------------:|------:|-----------:|"
  );
  for (const { variante, desempenho } of resultados) {
    const m = desempenho?.metricas ?? {};
    L.push(
      `| ${variante.letra} | ${desempenho?.ciclos ?? 0} | ${desempenho?.ciclosConcluidos ?? 0} | ${m.totalMs?.medianaMs ?? "—"} | ${m.totalMs?.p95Ms ?? "—"} | ${m.multimodalMs?.medianaMs ?? "—"} | ${m.temporalMs?.medianaMs ?? "—"} | ${m.deteccaoMs?.medianaMs ?? "—"} | ${desempenho?.ciclosComErro ?? 0} | ${desempenho?.cancelados ?? 0} |`
    );
  }
  L.push("");

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

  // Lideres por criterio: SOMENTE quando o veredito e conclusivo. Em rodada
  // invalida, listar "vencedores" seria repetir o defeito do comparativo de
  // 2026-10-18 (metricas iguais copiadas entre variantes).
  if (!comparabilidade.conclusivo) {
    L.push("## Líderes por critério", "");
    L.push("_Não há líderes: a rodada não atende ao critério de conclusão (ver problemas acima)._");
    L.push("");
  } else {
    const comQualidade = resultados.filter((r) => r.qualidade?.consolidado);
    const comDesempenho = resultados.filter((r) => (r.desempenho?.ciclosConcluidos ?? 0) > 0);
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
      const bTotal = pior(comDesempenho, (r) => r.desempenho.metricas.totalMs.medianaMs ?? Infinity);
      const bMulti = pior(comDesempenho, (r) => r.desempenho.metricas.multimodalMs.medianaMs ?? Infinity);
      const bErros = pior(comDesempenho, (r) => r.desempenho.ciclosComErro + r.desempenho.cancelados);
      L.push(`- **Menor latência total do ciclo (mediana):** ${bTotal.variante.letra} (${bTotal.desempenho.metricas.totalMs.medianaMs ?? "—"} ms)`);
      L.push(`- **Menor latência multimodal (mediana):** ${bMulti.variante.letra} (${bMulti.desempenho.metricas.multimodalMs.medianaMs ?? "—"} ms)`);
      L.push(`- **Mais robusta (erros + cancelamentos):** ${bErros.variante.letra} (${bErros.desempenho.ciclosComErro + bErros.desempenho.cancelados})`);
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
  // concluidos, sem modelo verificado ou com eventos compartilhados nao pode
  // produzir conclusao.
  const comparabilidade = avaliarComparabilidade(resultados, {
    modeloGlobal,
    minCiclosValidos: args.minCiclos,
    exigirQualidade: !args.semQualidade,
  });
  for (const p of comparabilidade.problemas) avisos.push(`comparabilidade: ${p}`);

  const fimEm = new Date().toISOString();
  const duracaoMs = Date.now() - inicioMs;
  Object.assign(ambiente, { fimEm, duracaoMs });

  // 4. Relatorios por variante + consolidado.
  const gravados = [];
  if (!args.semRelatorio) {
    for (const { variante, desempenho, qualidade, arquivoEventos, arquivoCiclos, modelos } of resultados) {
      const avisosDaVariante = [
        ...new Set([
          ...avisos.filter((a) => a.startsWith(`${variante.letra}:`)),
          ...comparabilidade.problemas.filter((p) => p.startsWith(`${variante.letra}:`)),
        ]),
      ];
      const conteudo = gerarRelatorioVariante({
        variante,
        clipes,
        desempenho,
        qualidade,
        arquivoEventos,
        arquivoCiclos,
        modelos,
        modelo: args.modeloPorVariante[variante.letra] ?? modeloGlobal,
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
  console.table(
    resultados.map(({ variante, desempenho, qualidade, modelos }) => {
      const m = desempenho?.metricas ?? {};
      const c = qualidade?.consolidado;
      return {
        variante: variante.letra,
        modo: variante.modo,
        modelo: (modelos?.visao ?? []).join(", ") || "-",
        "detector local": (modelos?.deteccao ?? []).join(", ") || "-",
        ciclos: desempenho?.ciclos ?? 0,
        concluidos: desempenho?.ciclosConcluidos ?? 0,
        "total med (ms)": m.totalMs?.medianaMs ?? "-",
        "total P95 (ms)": m.totalMs?.p95Ms ?? "-",
        "multimodal med (ms)": m.multimodalMs?.medianaMs ?? "-",
        F1: c ? pct(c.f1) : "-",
        precisao: c ? pct(c.precisao) : "-",
        recall: c ? pct(c.recall) : "-",
        "FP/min": c ? num(c.falsosPositivosPorMinuto) : "-",
        "nao detectados": c ? c.eventosNaoDetectados : "-",
        erros: desempenho?.ciclosComErro ?? 0,
        cancelados: desempenho?.cancelados ?? 0,
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
          gravados: gravados.map((g) => path.relative(ROOT, g)),
          avisos,
          resultados: resultados.map(
            ({ variante, desempenho, qualidade, arquivoEventos, arquivoCiclos, modelos, sessaoExplicita }) => ({
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
