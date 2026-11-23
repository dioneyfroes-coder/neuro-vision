/**
 * Verificação determinística da Fase 5 (Gemma, warm-up, orçamento, revisão).
 *
 * Não consulta LM Studio, não executa modelo e não lê mídia. Sem um snapshot
 * real de `/api/health` (`--health <arquivo.json>`), a saída é `N/A` com
 * status `INCONCLUSIVO` — nunca "disponível" e nunca uma métrica de desempenho.
 *
 * Uso:
 *   npm run verificar:gemma:nsfw
 *   npm run verificar:gemma:nsfw -- --health logs/health.json [--json]
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  avaliarDisponibilidadeGemma,
  erroLegivelGemma,
} from "../src/domain/disponibilidade-gemma.ts";
import { compararDescricoes } from "../src/domain/comparacao-descricoes.ts";
import { CONFIGURACAO_GEMMA_PADRAO } from "../src/nsfw-prompt/configuracao-gemma.ts";
import { orcamentoTokensNsfw as orcamento } from "../src/nsfw-prompt/orcamento-tokens.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function lerArgs() {
  const mapa = { json: false };
  const lista = process.argv.slice(2);
  for (let i = 0; i < lista.length; i += 1) {
    const arg = lista[i];
    const proximo = () => lista[++i] ?? "";
    if (arg === "--health") mapa.health = proximo();
    else if (arg === "--json") mapa.json = true;
    else if (arg === "--help" || arg === "-h") mapa.ajuda = true;
    else throw new Error(`argumento desconhecido: ${arg}`);
  }
  return mapa;
}

export function gerarRelatorioGemma(snapshot) {
  const configuracao = { ...CONFIGURACAO_GEMMA_PADRAO };
  const diagnostico = avaliarDisponibilidadeGemma({
    modelo: snapshot?.modelo ?? configuracao.modelo,
    online: snapshot?.online,
    modelos: snapshot?.modelos,
    carregados: snapshot?.carregados,
    erro: snapshot?.erro,
  });
  const medido = Boolean(snapshot) && diagnostico.status !== "nao_verificado";
  const comparacao = compararDescricoes(snapshot?.sfw, snapshot?.especializada);
  return {
    status: medido ? "observado" : "INCONCLUSIVO",
    base: medido ? "snapshot-health" : "sem_snapshot",
    configuracao: configuracao.modelo,
    gemma: diagnostico,
    erroLegivel: erroLegivelGemma(diagnostico),
    disponibilidadeMedida: medido,
    latenciaMs: null,
    ramMb: null,
    comparacaoDescricoes: comparacao,
    orcamentos: {
      leve: orcamento("leve"),
      equilibrado: orcamento("equilibrado"),
      completo: orcamento("completo"),
    },
  };
}

export async function main() {
  const args = lerArgs();
  if (args.ajuda) {
    console.log("Uso: npm run verificar:gemma:nsfw -- [--health <arquivo.json>] [--json]");
    return;
  }
  let snapshot;
  if (args.health) {
    snapshot = JSON.parse(await readFile(path.resolve(ROOT, args.health), "utf8"));
  }
  const relatorio = gerarRelatorioGemma(snapshot);
  if (args.json) {
    console.log(JSON.stringify(relatorio, null, 2));
    return;
  }
  console.log(`Verificação Gemma (Fase 5) — ${relatorio.status}`);
  console.log(`Base: ${relatorio.base}`);
  console.log(`Modelo configurado: ${relatorio.configuracao}`);
  console.log(`Disponibilidade: ${relatorio.gemma.status} (${relatorio.gemma.motivo})`);
  console.log(`Latência: N/A · RAM: N/A · precisão/recall: N/A`);
  console.log(
    `Comparação de descrições: ${relatorio.comparacaoDescricoes.status} ` +
      `(semelhança ${relatorio.comparacaoDescricoes.semelhancaLexica ?? "N/A"})`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
