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

export { SUBSISTEMAS } from "./benchmark-cadencia/constantes.mjs";
import { USO } from "./benchmark-cadencia/constantes.mjs";
export { lerCiclosJsonl } from "./benchmark-cadencia/io.mjs";
export { lerArgs } from "./benchmark-cadencia/args.mjs";
export { mediana, percentil } from "./benchmark-cadencia/estatistica.mjs";
export { ehCicloUtil, filtrarPorPolitica, aplicarWarmup } from "./benchmark-cadencia/filtros.mjs";
export { agregarAmostragem, agregarLatencia, resumirBenchmark } from "./benchmark-cadencia/agregacao.mjs";
export { formatarMarkdown } from "./benchmark-cadencia/relatorio.mjs";

import { lerCiclosJsonl } from "./benchmark-cadencia/io.mjs";
import { lerArgs } from "./benchmark-cadencia/args.mjs";
import { resumirBenchmark } from "./benchmark-cadencia/agregacao.mjs";
import { formatarMarkdown } from "./benchmark-cadencia/relatorio.mjs";

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
