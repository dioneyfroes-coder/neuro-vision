#!/usr/bin/env node

/**
 * Benchmark da cadencia independente de percepcao (Fase 1.3/1.4).
 *
 * Le o JSONL de ciclos persistidos (`logs/ciclos.jsonl`, registros
 * `RegistroCiclo`) e resume a **amostragem efetiva** por subsistema a partir de
 * `metricas.amostragem` — o plano realmente aplicado aos timestamps de captura,
 * nao a intencao da politica. Tambem calcula a latencia por etapa (mediana e
 * P95), para separar "quando o subsistema foi chamado" de "quanto custou".
 *
 * Diferenca para `scripts/benchmark-variantes.mjs`: aquele compara variantes
 * arquiteturais (A/B/C/D) e qualidade dos eventos; este responde apenas
 * "a cadencia de 5 FPS foi atingida?" e "a que custo de latencia?".
 *
 * Uso (PowerShell):
 *   node scripts/benchmark-cadencia.mjs
 *   node scripts/benchmark-cadencia.mjs --ciclos logs/ciclos.jsonl --json
 *   node scripts/benchmark-cadencia.mjs --politica benchmark-5fps --fps-alvo 5
 *   node scripts/benchmark-cadencia.mjs --saida bench/RELATORIO_CADENCIA_5FPS.md
 *
 * Saida: tabela legivel por padrao; `--json` imprime o resumo estruturado.
 * O veredito (`atingiu`) compara o FPS efetivo com o alvo, por subsistema, e
 * NUNCA arredonda um resultado que nao foi medido (sem amostras = `null`).
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Subsistemas na mesma ordem de `src/domain/cadencia.ts`. */
export const SUBSISTEMAS = ["deteccao", "pose", "maos", "nsfw"];

const USO = `
Uso: node scripts/benchmark-cadencia.mjs [opcoes]

Le ciclos ja persistidos e resume a amostragem efetiva e a latencia por etapa.

Opcoes:
  --ciclos <arquivo>    JSONL de RegistroCiclo (padrao: logs/ciclos.jsonl)
  --politica <id>       Filtra ciclos pela politica aplicada (ex.: benchmark-5fps)
  --fps-alvo <n>        Alvo de FPS para maos (padrao: 5)
  --warmup <n>          Descarta os N primeiros ciclos concluidos (padrao: 0)
  --min-ciclos <n>      Minimo de ciclos para dar veredito (padrao: 1)
  --json                Imprime o resumo estruturado (JSON) em vez da tabela
  --saida <arquivo>     Grava o relatorio Markdown no caminho indicado
  --ajuda               Mostra esta mensagem
`.trim();

/** Le e parseia um JSONL; linhas invalidas sao contadas e ignoradas. */
export function lerCiclosJsonl(texto) {
  const registros = [];
  let invalidas = 0;
  for (const linha of texto.split(/\r?\n/)) {
    const limpa = linha.trim();
    if (!limpa) continue;
    try {
      registros.push(JSON.parse(limpa));
    } catch {
      invalidas += 1;
    }
  }
  return { registros, invalidas };
}

/** Parseia argumentos sem depender de shell (compativel com PowerShell). */
export function lerArgs(lista = process.argv.slice(2)) {
  const opcoes = {
    ciclos: path.join(ROOT, "logs", "ciclos.jsonl"),
    politica: undefined,
    fpsAlvo: 5,
    warmup: 0,
    minCiclos: 1,
    json: false,
    saida: undefined,
    ajuda: false,
  };
  for (let i = 0; i < lista.length; i += 1) {
    const arg = lista[i];
    const proximo = () => {
      i += 1;
      const valor = lista[i];
      if (valor === undefined || valor.startsWith("--")) {
        throw new Error(`Faltou valor para ${arg}`);
      }
      return valor;
    };
    if (arg === "--ciclos") opcoes.ciclos = path.resolve(ROOT, proximo());
    else if (arg === "--politica") opcoes.politica = proximo();
    else if (arg === "--fps-alvo") opcoes.fpsAlvo = Math.max(0.1, Number(proximo()) || 5);
    else if (arg === "--warmup") opcoes.warmup = Math.max(0, Math.floor(Number(proximo()) || 0));
    else if (arg === "--min-ciclos") opcoes.minCiclos = Math.max(1, Math.floor(Number(proximo()) || 1));
    else if (arg === "--json") opcoes.json = true;
    else if (arg === "--saida") opcoes.saida = path.resolve(ROOT, proximo());
    else if (arg === "--ajuda" || arg === "-h") opcoes.ajuda = true;
    else throw new Error(`Opcao desconhecida: ${arg}`);
  }
  return opcoes;
}

const arredondar = (n, casas = 1) => {
  if (!Number.isFinite(n)) return null;
  const fator = 10 ** casas;
  return Math.round(n * fator) / fator;
};

export function mediana(valores) {
  const validos = valores.filter((n) => Number.isFinite(n));
  if (!validos.length) return null;
  const ordenado = [...validos].sort((a, b) => a - b);
  const meio = Math.floor(ordenado.length / 2);
  return ordenado.length % 2 ? ordenado[meio] : (ordenado[meio - 1] + ordenado[meio]) / 2;
}

/** Percentil por interpolacao linear (P95 = 0.95). */
export function percentil(valores, p) {
  const validos = valores.filter((n) => Number.isFinite(n));
  if (!validos.length) return null;
  const ordenado = [...validos].sort((a, b) => a - b);
  const pos = (ordenado.length - 1) * p;
  const base = Math.floor(pos);
  const resto = pos - base;
  const seguinte = ordenado[base + 1];
  return seguinte === undefined ? ordenado[base] : ordenado[base] + resto * (seguinte - ordenado[base]);
}

/** `true` quando o ciclo foi concluido (nao cancelado) e tem metricas. */
export function ehCicloUtil(registro) {
  return Boolean(registro) && registro.cancelado !== true && Boolean(registro.metricas);
}

export function filtrarPorPolitica(registros, politica) {
  if (!politica) return registros;
  return registros.filter((registro) => registro?.politica?.id === politica);
}

/** Descarta os N primeiros ciclos uteis (aquecimento de modelo/compilacao). */
export function aplicarWarmup(registros, warmup = 0) {
  if (warmup <= 0) return registros;
  let descartados = 0;
  return registros.filter((registro) => {
    if (!ehCicloUtil(registro) || descartados >= warmup) return true;
    descartados += 1;
    return false;
  });
}

/**
 * Agrega as metricas de amostragem de todos os ciclos.
 *
 * Para cada subsistema devolve: ciclos com amostragem, total de frames do plano,
 * amostrados, cobertura (amostrados/frames), FPS efetivo (mediana dos ciclos que
 * o registraram), intervalo alvo e FPS alvo derivado do intervalo.
 */
export function agregarAmostragem(registros, { fpsAlvo = 5 } = {}) {
  const porSubsistema = {};
  let janelaTotalMs = 0;
  let framesTotais = 0;
  let ciclosComAmostragem = 0;

  for (const registro of registros) {
    const amostragem = registro?.metricas?.amostragem;
    if (!amostragem) continue;
    ciclosComAmostragem += 1;
    const janelaMs = Number(amostragem.janelaMs) || 0;
    janelaTotalMs += janelaMs;
    const meta = registro?.politica?.cadencia;

    for (const subsistema of SUBSISTEMAS) {
      const metrica = amostragem.porSubsistema?.[subsistema];
      if (!metrica) continue;
      const acumulado = (porSubsistema[subsistema] ??= {
        ciclos: 0,
        amostrados: 0,
        frames: 0,
        fpsEfetivo: [],
        intervaloMedioMs: [],
        intervaloAlvoMs: new Set(),
        janelaMs: 0,
      });
      acumulado.ciclos += 1;
      acumulado.amostrados += Number(metrica.amostrados) || 0;
      const intervaloAlvo = Number(metrica.intervaloAlvoMs ?? meta?.[`${subsistema}Ms`]);
      if (Number.isFinite(intervaloAlvo) && intervaloAlvo > 0) {
        acumulado.intervaloAlvoMs.add(intervaloAlvo);
      }
      if (Number.isFinite(metrica.fpsEfetivo)) acumulado.fpsEfetivo.push(metrica.fpsEfetivo);
      if (Number.isFinite(metrica.intervaloMedioMs)) {
        acumulado.intervaloMedioMs.push(metrica.intervaloMedioMs);
      }
      acumulado.janelaMs += janelaMs;
      // Frames por ciclo = observacoes do registro (o plano tem um item por frame).
      acumulado.frames += Number(registro.observacoes) || 0;
    }
    framesTotais += Number(registro.observacoes) || 0;
  }

  const resumo = {};
  for (const subsistema of SUBSISTEMAS) {
    const acumulado = porSubsistema[subsistema];
    if (!acumulado) {
      resumo[subsistema] = {
        ciclos: 0,
        amostrados: 0,
        frames: 0,
        cobertura: null,
        fpsAlvo: null,
        fpsEfetivo: null,
        fpsEfetivoMaximo: null,
        intervaloAlvoMs: null,
        intervaloMedioMs: null,
        atingiu: null,
      };
      continue;
    }
    const intervalos = [...acumulado.intervaloAlvoMs];
    const intervaloAlvoMs = intervalos.length === 1 ? intervalos[0] : intervalos.length ? Math.min(...intervalos) : null;
    const fpsAlvoSubsistema =
      intervaloAlvoMs !== null ? arredondar(1000 / intervaloAlvoMs, 1) : subsistema === "maos" ? fpsAlvo : null;
    const fpsEfetivo = mediana(acumulado.fpsEfetivo);
    const cobertura =
      acumulado.frames > 0 ? arredondar(acumulado.amostrados / acumulado.frames, 3) : null;
    const alvo = fpsAlvoSubsistema ?? (subsistema === "maos" ? fpsAlvo : null);
    resumo[subsistema] = {
      ciclos: acumulado.ciclos,
      amostrados: acumulado.amostrados,
      frames: acumulado.frames,
      cobertura,
      fpsAlvo: arredondar(alvo, 1),
      fpsEfetivo: arredondar(fpsEfetivo, 1),
      fpsEfetivoMaximo: arredondar(Math.max(...acumulado.fpsEfetivo), 1),
      intervaloAlvoMs,
      intervaloMedioMs: Math.round(mediana(acumulado.intervaloMedioMs) ?? NaN) || null,
      // Tolerancia de 90% do alvo: jitter de captura nao reprova um benchmark.
      atingiu: fpsEfetivo !== null && alvo !== null ? arredondar(fpsEfetivo, 1) >= arredondar(alvo * 0.9, 1) : null,
    };
  }

  return {
    ciclosComAmostragem,
    framesTotais,
    janelaTotalMs: Math.round(janelaTotalMs),
    porSubsistema: resumo,
  };
}

/** Agrega a latencia por etapa de todos os ciclos (mediana e P95). */
export function agregarLatencia(registros) {
  const etapas = ["capturaMs", "deteccaoMs", "poseMs", "maosMs", "nsfwMs", "temporalMs", "multimodalMs", "totalMs"];
  const resumo = {};
  for (const etapa of etapas) {
    const valores = registros
      .map((registro) => registro?.metricas?.[etapa])
      .filter((valor) => Number.isFinite(valor));
    resumo[etapa] = {
      amostras: valores.length,
      mediana: arredondar(mediana(valores), 0),
      p95: arredondar(percentil(valores, 0.95), 0),
    };
  }
  return resumo;
}

/**
 * Monta o resumo final. `veredito` e `true` apenas quando ha ciclos suficientes
 * e todos os subsistemas medidos com alvo atingiram; caso contrario `false`.
 */
export function resumirBenchmark(registros, opcoes = {}) {
  const { politica, fpsAlvo = 5, minCiclos = 1, warmup = 0 } = opcoes;
  const uteis = aplicarWarmup(filtrarPorPolitica(registros.filter(ehCicloUtil), politica), warmup);
  const amostragem = agregarAmostragem(uteis, { fpsAlvo });
  const latencia = agregarLatencia(uteis);
  const avaliados = Object.entries(amostragem.porSubsistema).filter(([, resumo]) => resumo.atingiu !== null);
  const veredito =
    uteis.length >= minCiclos && avaliados.length > 0 && avaliados.every(([, resumo]) => resumo.atingiu === true);
  return {
    politica: politica ?? null,
    fpsAlvo,
    ciclos: uteis.length,
    suficiente: uteis.length >= minCiclos,
    veredito,
    amostragem,
    latencia,
    geradoEm: new Date().toISOString(),
  };
}

/** Relatorio Markdown legivel do resumo. */
export function formatarMarkdown(resumo) {
  const linhas = [];
  linhas.push("# Benchmark de cadencia da percepcao", "");
  linhas.push(`- Politica: \`${resumo.politica ?? "todas"}\``);
  linhas.push(`- Ciclos analisados: ${resumo.ciclos}${resumo.suficiente ? "" : " (amostra insuficiente)"}`);
  linhas.push(`- Alvo de maos: ${resumo.fpsAlvo} FPS`);
  linhas.push(`- Veredito: ${resumo.veredito ? "**ATINGIU**" : "**NAO ATINGIU**"}`);
  linhas.push(`- Gerado em: ${resumo.geradoEm}`, "");
  linhas.push("## Amostragem por subsistema", "");
  linhas.push(
    "| Subsistema | Ciclos | Frames | Amostrados | Cobertura | Alvo (FPS) | Efetivo (FPS) | Maximo (FPS) | Intervalo medio (ms) | Atingiu |"
  );
  linhas.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const [nome, resumoSub] of Object.entries(resumo.amostragem.porSubsistema)) {
    linhas.push(
      `| ${nome} | ${resumoSub.ciclos} | ${resumoSub.frames} | ${resumoSub.amostrados} | ` +
        `${resumoSub.cobertura ?? "-"} | ${resumoSub.fpsAlvo ?? "-"} | ${resumoSub.fpsEfetivo ?? "-"} | ` +
        `${resumoSub.fpsEfetivoMaximo ?? "-"} | ${resumoSub.intervaloMedioMs ?? "-"} | ` +
        `${resumoSub.atingiu === null ? "-" : resumoSub.atingiu ? "sim" : "nao"} |`
    );
  }
  linhas.push("", "## Latencia por etapa (ms)", "");
  linhas.push("| Etapa | Amostras | Mediana | P95 |");
  linhas.push("| --- | --- | --- | --- |");
  for (const [etapa, resumoEtapa] of Object.entries(resumo.latencia)) {
    if (!resumoEtapa.amostras) continue;
    linhas.push(`| ${etapa} | ${resumoEtapa.amostras} | ${resumoEtapa.mediana} | ${resumoEtapa.p95} |`);
  }
  linhas.push("");
  return linhas.join("\n");
}

async function principal() {
  const opcoes = lerArgs();
  if (opcoes.ajuda) {
    console.log(USO);
    return 0;
  }
  let texto;
  try {
    texto = await readFile(opcoes.ciclos, "utf8");
  } catch {
    console.error(`Nao foi possivel ler ${opcoes.ciclos}. Rode a aplicacao para gerar ciclos primeiro.`);
    return 1;
  }
  const { registros, invalidas } = lerCiclosJsonl(texto);
  if (invalidas > 0) console.error(`Aviso: ${invalidas} linha(s) invalida(s) ignorada(s).`);
  const resumo = resumirBenchmark(registros, opcoes);
  if (opcoes.json) {
    console.log(JSON.stringify(resumo, null, 2));
  } else {
    const markdown = formatarMarkdown(resumo);
    console.log(markdown);
    if (opcoes.saida) {
      await writeFile(opcoes.saida, markdown, "utf8");
      console.error(`Relatorio gravado em ${opcoes.saida}`);
    }
  }
  // Codigo nao zero quando nao ha ciclos suficientes; com veredito negativo, o
  // chamador decide (o relatorio ja traz `veredito`). Assim o benchmark nunca
  // "passa" sem medir.
  return resumo.suficiente ? 0 : 2;
}

const executadoDiretamente =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (executadoDiretamente) {
  principal()
    .then((codigo) => {
      process.exitCode = codigo;
    })
    .catch((erro) => {
      console.error(erro instanceof Error ? erro.message : erro);
      process.exitCode = 1;
    });
}
