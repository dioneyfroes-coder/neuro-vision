/**
 * Harness de concorrencia/latencia do conjunto NSFW (Fase 3 do plano).
 *
 * Nao executa modelos e nao acessa workers reais. Ele **resume janelas ja
 * instrumentadas** (`{modelo, inicioMs, fimMs, falha?}`) e recusa inventar
 * numeros: sem arquivo `--amostras`, o relatorio volta `sem_dados`.
 * Memoria RAM/WASM do PC alvo nao e coletada aqui e aparece como N/A.
 *
 * Uso:
 *   npm run verificar:concorrencia:nsfw [--json]
 *   npm run verificar:concorrencia:nsfw -- --amostras logs/amostras-nsfw.json \
 *     [--ambiente "PC alvo 20 nucleos"] [--json]
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resumirConcorrenciaNsfw } from "../src/domain/metricas-concorrencia-nsfw.ts";
import { ROOT } from "./avaliar-qualidade/constantes.mjs";

function lerArgs() {
  const mapa = { json: false };
  const lista = process.argv.slice(2);
  for (let i = 0; i < lista.length; i += 1) {
    const arg = lista[i];
    const proximo = () => lista[++i] ?? "";
    if (arg === "--amostras") mapa.amostras = proximo();
    else if (arg === "--ambiente") mapa.ambiente = proximo();
    else if (arg === "--json") mapa.json = true;
    else if (arg === "--help" || arg === "-h") mapa.ajuda = true;
    else throw new Error(`argumento desconhecido: ${arg}`);
  }
  return mapa;
}

export function gerarRelatorioConcorrencia(amostras, ambiente) {
  const resumo = resumirConcorrenciaNsfw(Array.isArray(amostras) ? amostras : []);
  return {
    ...resumo,
    base: resumo.status === "medido" ? "amostras-fornecidas" : "sem_amostras",
    ambiente: ambiente?.trim() || "nao informado",
    memoria: {
      status: "N/A",
      motivo: "heap JS, WASM linear e RAM total do processo nao coletados por este harness",
    },
  };
}

export async function main() {
  const args = lerArgs();
  if (args.ajuda) {
    console.log(
      "Uso: npm run verificar:concorrencia:nsfw -- [--amostras <arquivo.json>] [--ambiente <texto>] [--json]"
    );
    return;
  }

  let amostras = [];
  if (args.amostras) {
    const dados = JSON.parse(await readFile(path.resolve(ROOT, args.amostras), "utf8"));
    amostras = Array.isArray(dados) ? dados : dados?.amostras;
    if (!Array.isArray(amostras)) {
      throw new Error("--amostras deve ser um array ou um objeto com a chave 'amostras'");
    }
  }
  const relatorio = gerarRelatorioConcorrencia(amostras, args.ambiente);

  if (args.json) {
    console.log(JSON.stringify(relatorio, null, 2));
    return;
  }

  const fmt = (valor) => (valor === null || valor === undefined ? "N/A" : String(valor));
  console.log(`Concorrencia NSFW — ambiente: ${relatorio.ambiente}`);
  console.log(`Status: ${relatorio.status}${relatorio.motivo ? ` — ${relatorio.motivo}` : ""}`);
  console.log(`Amostras validas: ${relatorio.amostras} (invalidas: ${relatorio.amostrasInvalidas})`);
  console.log(`Concorrencia maxima observada: ${fmt(relatorio.concorrenciaMaxima)}`);
  console.log(
    `Latencia ms P50/P95/max: ${fmt(relatorio.latenciaMs.p50)} / ${fmt(relatorio.latenciaMs.p95)} / ${fmt(relatorio.latenciaMs.max)}`
  );
  console.log(`Falhas: ${relatorio.falhas}`);
  console.log(`Memoria: ${relatorio.memoria.status} — ${relatorio.memoria.motivo}`);
  console.log("Numeros descritivos das amostras fornecidas; nao substituem medicao no PC alvo.");
}

const caminhoDoModulo = fileURLToPath(import.meta.url);
const executadoDiretamente =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === caminhoDoModulo;

if (executadoDiretamente) {
  main().catch((erro) => {
    console.error(erro.message);
    process.exit(1);
  });
}
