/**
 * Compara respostas multimodais já coletadas com anotações humanas.
 *
 * Uso:
 *   npm run avaliar:multimodal -- --anotacao bench/.../anotacao.json \
 *     --respostas logs/respostas-multimodais.jsonl [--limite 0.5] [--json]
 *
 * Não executa modelo, não inventa anotação e não afirma precisão real: quando a
 * anotação não é revisada/de avaliação, as taxas são exibidas como N/A.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compararRespostasMultimodais } from "../src/domain/comparacao-multimodal.ts";
import { ROOT } from "./avaliar-qualidade/constantes.mjs";

function lerArgs() {
  const mapa = { limite: 0.5, respostas: "logs/respostas-multimodais.jsonl", json: false };
  const lista = process.argv.slice(2);
  for (let i = 0; i < lista.length; i += 1) {
    const arg = lista[i];
    const proximo = () => lista[++i] ?? "";
    if (arg === "--anotacao") mapa.anotacao = proximo();
    else if (arg === "--respostas") mapa.respostas = proximo();
    else if (arg === "--limite") mapa.limite = Number(proximo()) || 0.5;
    else if (arg === "--json") mapa.json = true;
  }
  return mapa;
}

async function lerJson(caminho) {
  return JSON.parse(await readFile(path.resolve(ROOT, caminho), "utf8"));
}

async function lerJsonl(caminho) {
  const texto = await readFile(path.resolve(ROOT, caminho), "utf8");
  return texto
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter(Boolean)
    .map((linha, indice) => {
      try {
        return JSON.parse(linha);
      } catch (erro) {
        throw new Error(`linha ${indice + 1} de ${caminho} não é JSON válido: ${erro.message}`);
      }
    });
}

function formatar(valor) {
  return valor === undefined ? "N/A" : String(valor);
}

export async function main() {
  const args = lerArgs();
  if (!args.anotacao) {
    console.error(
      "Uso: npm run avaliar:multimodal -- --anotacao <arquivo.json> --respostas <arquivo.jsonl> [--limite 0.5] [--json]"
    );
    process.exit(1);
  }
  const anotacao = await lerJson(args.anotacao);
  if (typeof anotacao !== "object" || anotacao === null || Array.isArray(anotacao)) {
    throw new Error("anotação inválida: esperado um objeto JSON");
  }
  const respostas = await lerJsonl(args.respostas);
  const relatorio = compararRespostasMultimodais(anotacao, respostas, {
    limiteSimilaridade: args.limite,
  });

  if (args.json) {
    console.log(JSON.stringify(relatorio, null, 2));
    return;
  }

  console.log(`Comparação multimodal — ${relatorio.clip ?? "clipe não informado"}`);
  console.log(`Afirmações esperadas: ${relatorio.totalEsperado}`);
  console.log(`Afirmações observadas: ${relatorio.totalObservado}`);
  console.log(`Correspondências: ${relatorio.acertos}`);
  console.log(
    `Precisão (comparação léxica): ${formatar(relatorio.precisao)}${
      relatorio.motivoMetricasIndisponiveis
        ? ` — ${relatorio.motivoMetricasIndisponiveis}`
        : " — anotação revisada de avaliação"
    }`
  );
  console.log(`Recall (comparação léxica): ${formatar(relatorio.recall)}`);
  console.log(`Referências não encontradas: ${relatorio.faltantes.join("; ") || "nenhuma"}`);
  console.log(`Afirmações extras: ${relatorio.extras.join("; ") || "nenhuma"}`);
  console.log(`Evidências inválidas: ${relatorio.evidenciasInvalidas}`);
  console.log(`Afirmações sem evidência: ${relatorio.afirmacoesSemEvidencia}`);
  console.log(
    `Latência medida: ${formatar(relatorio.latenciaMs.media)} ms (${relatorio.latenciaMs.amostras} amostras)`
  );
  console.log(`Tokens medidos: ${formatar(relatorio.tokens.total)} (${relatorio.tokens.amostras} amostras)`);
  console.log("Esta rotina não mede desempenho em condições reais nem substitui revisão humana.");
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
