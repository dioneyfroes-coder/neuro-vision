#!/usr/bin/env node

/**
 * Benchmark comparativo de modelos servidos por um backend compativel com a API
 * de "chat completions" (`/v1/chat/completions`, `/v1/models`) do LM Studio,
 * llama.cpp (`llama-server`) ou vLLM.
 *
 * Para cada modelo mede:
 *   - geracao de texto (sem imagem);
 *   - visao (com imagens fixas), agregando a mediana entre imagens;
 *   - tempo ate a primeira resposta, tokens e inferencias por minuto que o
 *     cliente consegue sustentar (respeitando o intervalo minimo).
 *
 * O resultado e uma tabela comparativa, util para escolher o modelo.
 *
 * Exemplos:
 *   node scripts/benchmark.mjs \
 *     --model qwen2.5-vl-3b-instruct --model gemma-4
 *   node scripts/benchmark.mjs --base-url http://127.0.0.1:1235 --images-dir bench/imagens
 *   node scripts/benchmark.mjs --json > bench/resultado.json
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "./benchmark/cli.mjs";

export { PROMPT_VISAO, montarPromptVisao } from "./benchmark/prompts.mjs";
export { inferenciasPorMinuto } from "./benchmark/comum.mjs";
export { montarAmbiente, resolverImagens, versaoDoCodigo } from "./benchmark/ambiente.mjs";
export { chamarGerar } from "./benchmark/api.mjs";
export { agregarVisoes, segundosDeGeracao } from "./benchmark/resultados.mjs";

const caminhoDoModulo = fileURLToPath(import.meta.url);
const executadoDiretamente =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === caminhoDoModulo;

if (executadoDiretamente) {
  main().catch((err) => {
    console.error(`ERRO: ${err.message}`);
    process.exit(1);
  });
}