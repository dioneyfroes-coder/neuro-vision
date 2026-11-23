/**
 * Harness de ações NSFW contra anotação humana revisada (Fase 4 do plano).
 *
 * Não executa modelo, não lê imagem e não inventa ground truth. Sem
 * `--anotacao` (ou com anotação que não passe os critérios do eval), o relatório
 * volta `N/A` com motivo — nunca `0`, nunca "aprovado". Com anotação v2
 * revisada, `conjunto: "eval"` e resolução melhor que 1 fps, compara intervalos
 * de ações já inferidos por uma execução anterior.
 *
 * Uso:
 *   npm run avaliar:acoes:nsfw [--json]
 *   npm run avaliar:acoes:nsfw -- --anotacao bench/clipes/eval/nsfw.json \
 *     --respostas logs/acoes-nsfw.json [--json]
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { avaliarAcoesNsfwAnotadas } from "../src/domain/avaliacao-nsfw-anotada.ts";
import { ROOT } from "./avaliar-qualidade/constantes.mjs";

function lerArgs() {
  const mapa = { json: false };
  const lista = process.argv.slice(2);
  for (let i = 0; i < lista.length; i += 1) {
    const arg = lista[i];
    const proximo = () => lista[++i] ?? "";
    if (arg === "--anotacao") mapa.anotacao = proximo();
    else if (arg === "--respostas") mapa.respostas = proximo();
    else if (arg === "--json") mapa.json = true;
    else if (arg === "--help" || arg === "-h") mapa.ajuda = true;
    else throw new Error(`argumento desconhecido: ${arg}`);
  }
  return mapa;
}

async function lerJson(caminho) {
  return JSON.parse(await readFile(path.resolve(ROOT, caminho), "utf8"));
}

/** Extrai ações de um resultado de interpretação já coletado. */
function acoesDasRespostas(dados) {
  const registros = Array.isArray(dados) ? dados : [dados];
  return registros.flatMap((r) => (Array.isArray(r?.acoes) ? r.acoes : []));
}

export function gerarRelatorioAcoesNsfw(anotacao, respostas) {
  const avaliacao = avaliarAcoesNsfwAnotadas(anotacao, acoesDasRespostas(respostas));
  return {
    ...avaliacao,
    base: avaliacao.status === "medido" ? "anotacao-revisada" : "sem_anotacao_revisada",
    metricasDisponiveis: avaliacao.status === "medido",
  };
}

export async function main() {
  const args = lerArgs();
  if (args.ajuda) {
    console.log(
      "Uso: npm run avaliar:acoes:nsfw -- [--anotacao <arquivo.json>] [--respostas <arquivo.json>] [--json]"
    );
    return;
  }

  let anotacao;
  if (args.anotacao) anotacao = await lerJson(args.anotacao);
  let respostas = [];
  if (args.respostas) respostas = await lerJson(args.respostas);

  const relatorio = gerarRelatorioAcoesNsfw(anotacao, respostas);
  if (args.json) {
    console.log(JSON.stringify(relatorio, null, 2));
    return;
  }

  const fmt = (valor) => (valor === null || valor === undefined ? "N/A" : valor.toFixed(3));
  console.log(`Avaliação de ações NSFW — ${relatorio.status}`);
  if (relatorio.motivo) console.log(`Motivo: ${relatorio.motivo}`);
  console.log(`Base: ${relatorio.base}`);
  console.log(`Ações anotadas/inferidas: ${relatorio.acoesAnotadas}/${relatorio.acoesInferidas}`);
  console.log(`Correspondências: ${relatorio.correspondencias}`);
  console.log(`Falsos positivos/omissões: ${relatorio.falsosPositivos}/${relatorio.omissoes}`);
  console.log(`Precisão/recall: ${fmt(relatorio.precisao)} / ${fmt(relatorio.recall)}`);
  if (!relatorio.metricasDisponiveis) {
    console.log("Nenhuma taxa é divulgada sem anotação humana revisada e resolução melhor que 1 fps.");
  }
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
