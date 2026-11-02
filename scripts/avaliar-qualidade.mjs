#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Tipos de evento visual aceitos (ver `src/types.ts`). */
const TIPOS = ["aparicao", "desaparecimento", "movimento", "mudanca_de_cena", "resumo"];
const CATEGORIAS = [
  "gesto",
  "postura",
  "movimento_corporal",
  "movimento_objeto",
  "aparicao_desaparecimento",
  "interpretacao_textual",
];
const VISIBILIDADES = ["clara", "parcial", "ocluida", "impossivel_de_determinar"];
const PARTES_ENVOLVIDAS = [
  "mao_esquerda",
  "mao_direita",
  "ambas_as_maos",
  "braco_esquerdo",
  "braco_direito",
  "tronco",
  "corpo_inteiro",
  "objeto",
  "indeterminado",
];

/** Eventos que nao representam uma "mudanca" e por isso nao contam como falso positivo. */
export const TIPOS_IGNORADOS_PADRAO = ["resumo"];

function lerArgs() {
  const mapa = { tolerancia: 3000, offset: 0, eventos: "logs/eventos.jsonl", json: false };
  const lista = process.argv.slice(2);
  for (let i = 0; i < lista.length; i++) {
    const a = lista[i];
    const proximo = () => lista[++i] ?? "";
    if (a === "--anotacao") mapa.anotacao = proximo();
    else if (a === "--eventos") mapa.eventos = proximo();
    else if (a === "--tolerancia") mapa.tolerancia = Math.max(0, Number(proximo()) || 0);
    else if (a === "--offset") mapa.offset = Number(proximo()) || 0;
    else if (a === "--ignorados") mapa.ignorados = proximo().split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--json") mapa.json = true;
  }
  return mapa;
}

function arredondar(n, casas = 2) {
  const fator = 10 ** casas;
  return Math.round(n * fator) / fator;
}

/**
 * Valida e normaliza uma anotacao (eventos esperados de um clipe).
 *
 * Formato aceito:
 *   { "clip": "sala.mp4", "inicio": "<ISO>", "duracaoMs": 60000,
 *     "eventos": [{ "tipo": "aparicao", "em": 5000, "descricao": "pessoa entra" }] }
 *
 * `em` e o instante do evento em **ms desde o inicio da gravacao**. `tipo` pode
 * ser um dos tipos de `EventoVisual` ou `"qualquer"` (casa com qualquer mudanca).
 * A versao 2 tambem guarda intervalos e metadados para avaliacao humana; os
 * campos continuam opcionais para preservar as anotacoes legadas.
 *
 * A base dos offsets vem, por precedencia: do sidecar `<eventos>.inicio` (ISO
 * gravado junto ao JSONL; sidecars legados podem substituir `.jsonl` por
 * `.inicio`), do campo `inicio` da anotacao, ou do timestamp detectado mais
 * antigo.
 */
export function carregarAnotacao(dados) {
  if (typeof dados !== "object" || dados === null || Array.isArray(dados)) {
    throw new Error("anotacao invalida: esperado um objeto JSON");
  }
  const versaoEsquema = dados.versaoEsquema ?? 1;
  if (versaoEsquema !== 1 && versaoEsquema !== 2) {
    throw new Error(`versao de anotacao desconhecida: ${dados.versaoEsquema}`);
  }
  const revisao =
    typeof dados.revisao === "object" && dados.revisao !== null && !Array.isArray(dados.revisao)
      ? dados.revisao
      : undefined;
  if (versaoEsquema === 2) {
    if (!["eval", "tuning"].includes(dados.conjunto)) {
      throw new Error('anotacao v2 precisa de "conjunto" igual a eval ou tuning');
    }
    if (
      !revisao ||
      !["rascunho", "revisada"].includes(revisao.status) ||
      typeof revisao.metodo !== "string" ||
      revisao.metodo.trim() === ""
    ) {
      throw new Error('anotacao v2 precisa de "revisao.status" e "revisao.metodo"');
    }
  }
  const duracaoMs =
    Number.isFinite(dados.duracaoMs) && dados.duracaoMs > 0 ? dados.duracaoMs : undefined;
  const eventos = Array.isArray(dados.eventos) ? dados.eventos : [];
  const negativos = dados.negativos ?? [];
  if (
    !Array.isArray(negativos) ||
    negativos.some((alvo) => typeof alvo !== "string" || alvo.trim() === "") ||
    new Set(negativos).size !== negativos.length
  ) {
    throw new Error('"negativos" deve ser uma lista sem duplicatas de alvos categoria.classe');
  }
  if (
    versaoEsquema === 2 &&
    dados.conjunto === "eval" &&
    eventos.length === 0 &&
    dados.casoNegativo !== true &&
    negativos.length === 0
  ) {
    throw new Error(
      'anotacao EVAL sem eventos precisa declarar "casoNegativo": true ou "negativos" por classe'
    );
  }
  if (versaoEsquema === 2 && dados.casoNegativo === true && eventos.length > 0) {
    throw new Error('"casoNegativo" nao pode coexistir com eventos positivos');
  }
  const normalizados = eventos.map((e, i) => {
    if (typeof e !== "object" || e === null || Array.isArray(e)) {
      throw new Error(`evento ${i} invalido: esperado um objeto`);
    }
    if (typeof e.tipo !== "string") throw new Error(`evento ${i} sem "tipo"`);
    const tipo = e.tipo.toLowerCase();
    if (tipo !== "qualquer" && !TIPOS.includes(tipo)) {
      throw new Error(`evento ${i} com tipo desconhecido: ${e.tipo}`);
    }
    const inicioMs = e.inicioMs ?? e.em;
    const fimMs = e.fimMs ?? e.em ?? inicioMs;
    const em = e.em ?? inicioMs;
    for (const [campo, valor] of [
      ["inicioMs", inicioMs],
      ["fimMs", fimMs],
      ["em", em],
    ]) {
      if (typeof valor !== "number" || !Number.isFinite(valor) || valor < 0) {
        throw new Error(`evento ${i} precisa de "${campo}" em ms (>= 0)`);
      }
    }
    if (inicioMs > fimMs) {
      throw new Error(`evento ${i} invalido: "inicioMs" deve ser <= "fimMs"`);
    }
    if (em < inicioMs || em > fimMs) {
      throw new Error(`evento ${i} invalido: "em" deve estar dentro do intervalo`);
    }
    if (duracaoMs && fimMs > duracaoMs) {
      throw new Error(`evento ${i} excede "duracaoMs"`);
    }
    if (e.categoria !== undefined && !CATEGORIAS.includes(e.categoria)) {
      throw new Error(`evento ${i} com categoria desconhecida: ${e.categoria}`);
    }
    if (e.visibilidade !== undefined && !VISIBILIDADES.includes(e.visibilidade)) {
      throw new Error(`evento ${i} com visibilidade desconhecida: ${e.visibilidade}`);
    }
    if (e.parteEnvolvida !== undefined && !PARTES_ENVOLVIDAS.includes(e.parteEnvolvida)) {
      throw new Error(`evento ${i} com parte envolvida desconhecida: ${e.parteEnvolvida}`);
    }
    if (e.determinavel !== undefined && typeof e.determinavel !== "boolean") {
      throw new Error(`evento ${i}: "determinavel" deve ser booleano`);
    }
    if (
      versaoEsquema === 2 &&
      (!Number.isFinite(e.inicioMs) ||
        !Number.isFinite(e.fimMs) ||
        !CATEGORIAS.includes(e.categoria) ||
        typeof e.classe !== "string" ||
        e.classe.trim() === "" ||
        !VISIBILIDADES.includes(e.visibilidade) ||
        !PARTES_ENVOLVIDAS.includes(e.parteEnvolvida) ||
        typeof e.determinavel !== "boolean")
    ) {
      throw new Error(`evento ${i}: anotacao v2 precisa dos metadados humanos completos`);
    }
    return {
      tipo,
      em,
      descricao: typeof e.descricao === "string" ? e.descricao : "",
      ...(inicioMs !== em || e.inicioMs !== undefined ? { inicioMs } : {}),
      ...(fimMs !== em || e.fimMs !== undefined ? { fimMs } : {}),
      ...(e.categoria !== undefined ? { categoria: e.categoria } : {}),
      ...(typeof e.classe === "string" ? { classe: e.classe } : {}),
      ...(e.visibilidade !== undefined ? { visibilidade: e.visibilidade } : {}),
      ...(e.parteEnvolvida !== undefined ? { parteEnvolvida: e.parteEnvolvida } : {}),
      ...(e.determinavel !== undefined ? { determinavel: e.determinavel } : {}),
    };
  });
  return {
    clip: typeof dados.clip === "string" ? dados.clip : "",
    versaoEsquema,
    conjunto: typeof dados.conjunto === "string" ? dados.conjunto : undefined,
    casoNegativo: dados.casoNegativo === true,
    negativos,
    revisao,
    inicio: typeof dados.inicio === "string" ? dados.inicio : undefined,
    duracaoMs,
    notas: typeof dados.notas === "string" ? dados.notas : "",
    eventos: normalizados,
  };
}

/** Le o JSONL de eventos gravado pelo app, ignorando linhas corrompidas/incompletas. */
export function parsearEventos(texto) {
  const eventos = [];
  for (const linha of String(texto ?? "").split(/\r?\n/)) {
    const limpa = linha.trim();
    if (!limpa) continue;
    try {
      const evt = JSON.parse(limpa);
      if (typeof evt?.timestamp !== "string" || typeof evt?.tipo !== "string") continue;
      eventos.push({
        tipo: evt.tipo,
        timestamp: evt.timestamp,
        descricao: evt.descricao ?? "",
        ...(typeof evt.rotuloObjeto === "string" ? { rotuloObjeto: evt.rotuloObjeto } : {}),
        ...(Array.isArray(evt.origensSinal)
          ? {
              origensSinal: evt.origensSinal.filter((origem) =>
                ["objetos", "pose", "maos", "cena", "movimento"].includes(origem)
              ),
            }
          : {}),
      });
    } catch {
      // linha corrompida: ignora
    }
  }
  return eventos;
}

function tiposCompativeis(esperado, detectado) {
  return esperado === "qualquer" || esperado === detectado;
}

/**
 * Resolve a base (ms) para converter timestamps ISO em offsets `em`.
 *
 * Precedencia:
 *   1. `inicioSidecar`: um ISO gravado ao lado do JSONL de eventos (ex.: o
 *      instante em que o clipe comecou a tocar durante uma avaliacao com clipe
 *      real). Torna a medicao reprodutivel sem editar a anotacao a cada rodada.
 *   2. `inicio`: o campo `inicio` da anotacao.
 *   3. O timestamp detectado mais antigo.
 *   4. 0, quando nao ha nada.
 */
export function resolverBaseMs({ inicio, inicioSidecar, timestamps = [] } = {}) {
  if (inicioSidecar && Number.isFinite(Date.parse(inicioSidecar))) return Date.parse(inicioSidecar);
  if (inicio && Number.isFinite(Date.parse(inicio))) return Date.parse(inicio);
  const validos = timestamps.map((t) => Date.parse(t)).filter((n) => Number.isFinite(n));
  return validos.length ? Math.min(...validos) : 0;
}

export async function lerInicioSidecarEventos(caminhoEventos) {
  const candidatos = [
    `${caminhoEventos}.inicio`,
    caminhoEventos.replace(/\.jsonl$/i, ".inicio"),
  ];
  for (const candidato of new Set(candidatos)) {
    const texto = await readFile(candidato, "utf8").catch(() => undefined);
    if (texto !== undefined) return texto.trim();
  }
  return undefined;
}

function taxa(numerador, denominador) {
  if (denominador <= 0) return 1;
  return numerador / denominador;
}

function calcularDuracaoMs(esperados, detectados) {
  const pontos = [...esperados.map((e) => e.em), ...detectados.map((d) => d.em)];
  if (!pontos.length) return 0;
  return Math.max(0, Math.max(...pontos) - Math.min(...pontos));
}

/**
 * Compara eventos esperados com os detectados e calcula precisao, recall,
 * mudancas perdidas e falsos positivos por minuto.
 *
 * Recebe listas ja com `em` (ms) numerico. Para cada evento esperado procura a
 * deteccao de **tipo compativel** mais proxima dentro da tolerancia; cada
 * deteccao so pode casar uma vez. O escopo de objeto exige origem e rotulo
 * conhecidos para nao confundir movimento de pessoa com objeto deslocado.
 */
export function compararEventos({
  esperados = [],
  detectados = [],
  escopoClasse,
  toleranciaMs = 3000,
  ignorados = TIPOS_IGNORADOS_PADRAO,
  duracaoMs,
} = {}) {
  const ignoradosSet = new Set(ignorados);
  const escopoDeObjeto = escopoClasse === "movimento_objeto.objeto_deslocado";
  const movimentos = escopoDeObjeto
    ? detectados.filter((d) => d.tipo === "movimento" && !ignoradosSet.has(d.tipo))
    : [];
  const classificadosNoEscopo = movimentos.filter(
    (d) =>
      d.origensSinal?.includes("objetos") &&
      typeof d.rotuloObjeto === "string" &&
      d.rotuloObjeto.trim().length > 0
  );
  const semClassificacaoEscopo = movimentos.length - classificadosNoEscopo.length;
  const movimentosPessoaExcluidos = classificadosNoEscopo.filter((d) =>
    ["person", "pessoa"].includes(d.rotuloObjeto.trim().toLowerCase())
  ).length;
  const candidatos = detectados.filter((d) => {
    if (ignoradosSet.has(d.tipo)) return false;
    if (!escopoDeObjeto) return true;
    return (
      classificadosNoEscopo.includes(d) &&
      !["person", "pessoa"].includes(d.rotuloObjeto.trim().toLowerCase())
    );
  });
  const noEscopo = esperados.filter(
    (e) =>
      escopoClasse !== "movimento_objeto.objeto_deslocado" ||
      (e.categoria === "movimento_objeto" && e.classe === "objeto_deslocado")
  );
  const avaliaveis = noEscopo.filter((e) => e.determinavel !== false);

  const usados = new Set();
  const correspondencias = [];
  const perdidos = [];
  for (const esperado of avaliaveis) {
    let melhorIndice = -1;
    let melhorDistancia = Infinity;
    for (let i = 0; i < candidatos.length; i++) {
      if (usados.has(i)) continue;
      const cand = candidatos[i];
      if (!tiposCompativeis(esperado.tipo, cand.tipo)) continue;
      const distancia = Math.abs(cand.em - esperado.em);
      if (distancia <= toleranciaMs && distancia < melhorDistancia) {
        melhorIndice = i;
        melhorDistancia = distancia;
      }
    }
    if (melhorIndice >= 0) {
      usados.add(melhorIndice);
      correspondencias.push({
        esperado,
        detectado: candidatos[melhorIndice],
        distanciaMs: melhorDistancia,
      });
    } else {
      perdidos.push(esperado);
    }
  }

  const falsosPositivos = candidatos.filter((_, i) => !usados.has(i));
  const tp = correspondencias.length;
  const fp = falsosPositivos.length;
  const fn = perdidos.length;
  const duracaoEfetivaMs =
    duracaoMs && duracaoMs > 0 ? duracaoMs : calcularDuracaoMs(avaliaveis, candidatos);

  return {
    esperados: avaliaveis.length,
    indeterminados: noEscopo.length - avaliaveis.length,
    foraEscopo: esperados.length - noEscopo.length,
    escopoClasse,
    semClassificacaoEscopo,
    movimentosPessoaExcluidos,
    detectados: candidatos.length,
    verdadeirosPositivos: tp,
    perdidos: fn,
    falsosPositivos: fp,
    precisao: taxa(tp, tp + fp),
    recall: taxa(tp, tp + fn),
    /** Proporcao de mudancas esperadas que nao foram detectadas (0 quando nao ha mudancas esperadas). */
    proporcaoPerdidas: tp + fn === 0 ? 0 : fn / (tp + fn),
    falsosPositivosPorMinuto: duracaoEfetivaMs > 0 ? fp / (duracaoEfetivaMs / 60_000) : 0,
    duracaoMs: duracaoEfetivaMs,
    correspondencias,
    perdidosDetalhe: perdidos,
    falsosPositivosDetalhe: falsosPositivos,
  };
}

function pct(n) {
  return `${(n * 100).toFixed(0)}%`;
}

/** Relatorio legivel (modo padrao, sem `--json`). */
export function formatarRelatorio(rel, { clip = "", toleranciaMs = 0 } = {}) {
  const linhas = [
    `Clipe: ${clip || "(sem nome)"} | tolerancia: ${toleranciaMs} ms | duracao: ${arredondar(rel.duracaoMs / 60_000, 2)} min`,
    `Esperados: ${rel.esperados} | detectados: ${rel.detectados}`,
    `Verdadeiros positivos: ${rel.verdadeirosPositivos} | perdidos: ${rel.perdidos} | falsos positivos: ${rel.falsosPositivos}`,
    `Precisao: ${pct(rel.precisao)} | recall: ${pct(rel.recall)} | falsos positivos/min: ${arredondar(rel.falsosPositivosPorMinuto, 2)}`,
  ];
  if (rel.foraEscopo > 0) linhas.push(`Fora do escopo avaliado: ${rel.foraEscopo}`);
  if (rel.semClassificacaoEscopo > 0) {
    linhas.push(`Movimentos sem classificação de escopo: ${rel.semClassificacaoEscopo}`);
  }
  if (rel.movimentosPessoaExcluidos > 0) {
    linhas.push(`Movimentos de pessoa excluídos: ${rel.movimentosPessoaExcluidos}`);
  }
  if (rel.perdidosDetalhe.length) {
    linhas.push("Perdidas:");
    for (const p of rel.perdidosDetalhe) {
      linhas.push(`  - ${p.tipo} @ ${p.em} ms${p.descricao ? ` (${p.descricao})` : ""}`);
    }
    if (rel.indeterminados) {
      linhas.push(`Excluidos por indeterminacao: ${rel.indeterminados}`);
    }
  }
  if (rel.falsosPositivosDetalhe.length) {
    linhas.push("Falsos positivos:");
    for (const f of rel.falsosPositivosDetalhe) {
      linhas.push(`  - ${f.tipo} @ ${Math.round(f.em)} ms${f.descricao ? ` (${f.descricao})` : ""}`);
    }
  }
  return linhas.join("\n");
}

async function main() {
  const args = lerArgs();
  if (!args.anotacao) {
    console.error(
      "Uso: npm run qualidade -- --anotacao bench/videos/<clipe>.json [--eventos logs/eventos.jsonl] [--tolerancia 3000] [--offset 0] [--ignorados resumo] [--json]"
    );
    process.exit(1);
  }

  const caminhoAnotacao = path.resolve(ROOT, args.anotacao);
  const anotacao = carregarAnotacao(JSON.parse(await readFile(caminhoAnotacao, "utf8")));

  const caminhoEventos = path.resolve(ROOT, args.eventos);
  const texto = await readFile(caminhoEventos, "utf8").catch(() => null);
  if (texto === null) {
    console.error(
      `Nao encontrei ${args.eventos}. Rode o app sobre o clipe e colete os eventos (logs/eventos.jsonl) antes de avaliar.`
    );
    process.exit(1);
  }

  const brutos = parsearEventos(texto);
  // Sidecars antigos substituiam `.jsonl` por `.inicio`; ambos os formatos sao aceitos.
  const inicioSidecar = await lerInicioSidecarEventos(caminhoEventos);
  const baseMs = resolverBaseMs({
    inicio: anotacao.inicio,
    inicioSidecar,
    timestamps: brutos.map((e) => e.timestamp),
  });
  const detectados = brutos
    .map((e) => ({ ...e, em: Date.parse(e.timestamp) - baseMs + args.offset }))
    .filter((e) => Number.isFinite(e.em));

  const escopoClasse =
    anotacao.negativos.includes("movimento_objeto.objeto_deslocado") ||
    anotacao.eventos.some(
      (evento) =>
        evento.categoria === "movimento_objeto" &&
        evento.classe === "objeto_deslocado"
    )
      ? "movimento_objeto.objeto_deslocado"
      : undefined;
  const rel = compararEventos({
    esperados: anotacao.eventos,
    detectados,
    escopoClasse,
    toleranciaMs: args.tolerancia,
    ignorados: args.ignorados ?? TIPOS_IGNORADOS_PADRAO,
    duracaoMs: anotacao.duracaoMs,
  });

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          clip: anotacao.clip,
          eventos: args.eventos,
          toleranciaMs: args.tolerancia,
          offsetMs: args.offset,
          ignorados: args.ignorados ?? TIPOS_IGNORADOS_PADRAO,
          ...rel,
        },
        null,
        2
      )
    );
    return;
  }

  console.log(formatarRelatorio(rel, { clip: anotacao.clip, toleranciaMs: args.tolerancia }));
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
