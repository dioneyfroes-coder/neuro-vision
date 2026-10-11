#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Tipos de evento visual aceitos (ver `src/types.ts`). */
const TIPOS = ["aparicao", "desaparecimento", "movimento", "mudanca_de_cena", "resumo"];

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
 */
export function carregarAnotacao(dados) {
  if (typeof dados !== "object" || dados === null || Array.isArray(dados)) {
    throw new Error("anotacao invalida: esperado um objeto JSON");
  }
  const eventos = Array.isArray(dados.eventos) ? dados.eventos : [];
  const normalizados = eventos.map((e, i) => {
    if (typeof e !== "object" || e === null || Array.isArray(e)) {
      throw new Error(`evento ${i} invalido: esperado um objeto`);
    }
    if (typeof e.tipo !== "string") throw new Error(`evento ${i} sem "tipo"`);
    const tipo = e.tipo.toLowerCase();
    if (tipo !== "qualquer" && !TIPOS.includes(tipo)) {
      throw new Error(`evento ${i} com tipo desconhecido: ${e.tipo}`);
    }
    if (typeof e.em !== "number" || !Number.isFinite(e.em) || e.em < 0) {
      throw new Error(`evento ${i} precisa de "em" (ms desde o inicio, >= 0)`);
    }
    return { tipo, em: e.em, descricao: typeof e.descricao === "string" ? e.descricao : "" };
  });
  return {
    clip: typeof dados.clip === "string" ? dados.clip : "",
    inicio: typeof dados.inicio === "string" ? dados.inicio : undefined,
    duracaoMs:
      Number.isFinite(dados.duracaoMs) && dados.duracaoMs > 0 ? dados.duracaoMs : undefined,
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
      eventos.push({ tipo: evt.tipo, timestamp: evt.timestamp, descricao: evt.descricao ?? "" });
    } catch {
      // linha corrompida: ignora
    }
  }
  return eventos;
}

function tiposCompativeis(esperado, detectado) {
  return esperado === "qualquer" || esperado === detectado;
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
 * deteccao so pode casar uma vez. O casamento e "melhor-esforco" e deterministico.
 */
export function compararEventos({
  esperados = [],
  detectados = [],
  toleranciaMs = 3000,
  ignorados = TIPOS_IGNORADOS_PADRAO,
  duracaoMs,
} = {}) {
  const ignoradosSet = new Set(ignorados);
  const candidatos = detectados.filter((d) => !ignoradosSet.has(d.tipo));

  const usados = new Set();
  const correspondencias = [];
  const perdidos = [];
  for (const esperado of esperados) {
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
    duracaoMs && duracaoMs > 0 ? duracaoMs : calcularDuracaoMs(esperados, candidatos);

  return {
    esperados: esperados.length,
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
  if (rel.perdidosDetalhe.length) {
    linhas.push("Perdidas:");
    for (const p of rel.perdidosDetalhe) {
      linhas.push(`  - ${p.tipo} @ ${p.em} ms${p.descricao ? ` (${p.descricao})` : ""}`);
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
  const baseMs = anotacao.inicio
    ? Date.parse(anotacao.inicio)
    : brutos.length
      ? Math.min(...brutos.map((e) => Date.parse(e.timestamp)))
      : 0;
  const detectados = brutos
    .map((e) => ({ ...e, em: Date.parse(e.timestamp) - baseMs + args.offset }))
    .filter((e) => Number.isFinite(e.em));

  const rel = compararEventos({
    esperados: anotacao.eventos,
    detectados,
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
