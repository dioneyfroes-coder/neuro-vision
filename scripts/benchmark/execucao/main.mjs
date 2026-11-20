import { montarAmbiente } from "../../benchmark.mjs";
import { validarConjuntoEval } from "../../validar-eval.mjs";
import path from "node:path";
import { lerArgs } from "../args.mjs";
import { ROOT, USO, VARIANTES_BENCHMARK } from "../constantes.mjs";
import { dataHoraCurta } from "../estatistica.mjs";
import { descobrirClipes } from "../artefatos.mjs";
import { avaliarGateQualidade } from "../metricas.mjs";
import { avaliarComparabilidade, verificarMesmoModelo } from "../comparabilidade.mjs";
import { definirToleranciaRelatorio } from "../relatorio.mjs";
import { backendSeguro } from "./backend-seguro.mjs";
import { processarVariante } from "./processar-variante.mjs";
import { emitirResultados } from "./saida.mjs";

export async function main() {
  const args = lerArgs();
  if (args.help) {
    console.log(USO);
    return;
  }
  definirToleranciaRelatorio(args.tolerancia);
  const data = args.data || dataHoraCurta();
  const ambiente = montarAmbiente();
  const avisos = [];
  const inicioEm = new Date().toISOString();
  const inicioMs = Date.now();
  const backend = backendSeguro(process.env.NEURO_BASE_URL);
  Object.assign(ambiente, { inicioEm, backend, minCiclosValidos: args.minCiclos, minAmostrasEstatisticas: args.minAmostrasEstatisticas, warmups: args.warmups, etapasIsoladas: args.etapasIsoladas, conjunto: args.conjunto, criteriosQualidade: args.criteriosQualidade, semQualidade: args.semQualidade });

  const variantes = VARIANTES_BENCHMARK.filter((v) => args.variantes.includes(v.letra));
  const modeloGlobal = args.modeloVisao ?? process.env.NEURO_MODELO_VISAO ?? "";

  if (args.conjunto === "eval") {
    const diretorioEval = path.resolve(ROOT, "bench", "clipes", "eval");
    const diretorioVideos = path.resolve(ROOT, "bench", "videos");
    if (!args.anotacoesDir || path.resolve(ROOT, args.anotacoesDir) !== diretorioEval || path.resolve(ROOT, args.clipesDir) !== diretorioVideos || args.clipes.length > 0) {
      console.error("ERRO: eval exige o conjunto completo de bench/videos e --anotacoes-dir bench/clipes/eval.");
      process.exitCode = 1;
      return;
    }
    const gateEval = await validarConjuntoEval();
    if (!gateEval.valido) {
      console.error("ERRO: conjunto EVAL nao passou pelo gate da Fase 4:");
      for (const erro of gateEval.erros) console.error(`  - ${erro}`);
      process.exitCode = 1;
      return;
    }
  }

  const clipes = await descobrirClipes(args.clipesDir, args.clipes, args.anotacoesDir, args.conjunto === "eval");
  if (!clipes.length) {
    console.error(`ERRO: nenhum clipe encontrado em ${args.clipesDir || args.clipes.join(", ")}. Use --clipes-dir ou --clipes.`);
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
    resultados.push(await processarVariante({ variante, clipes, args, avisos, modeloGlobal }));
  }

  const verificacaoModelo = verificarMesmoModelo(resultados, modeloGlobal);
  const comparabilidade = avaliarComparabilidade(resultados, { modeloGlobal, minCiclosValidos: args.minCiclos, minAmostrasEstatisticas: args.minAmostrasEstatisticas, exigirQualidade: !args.semQualidade });
  for (const p of comparabilidade.problemas) avisos.push(`comparabilidade: ${p}`);
  for (const l of comparabilidade.limitacoesEstatisticas) avisos.push(`estatistica: ${l}`);

  const gateQualidade = avaliarGateQualidade(resultados, args.criteriosQualidade);
  if (!args.semQualidade) {
    for (const g of gateQualidade.porVariante) {
      console.log(`  gate ${g.letra}: ${g.promovivel ? "PROMOVIVEL a padrao" : "manter experimental"}${g.motivo ? ` — ${g.motivo}` : ""}`);
    }
  }

  const fimEm = new Date().toISOString();
  const duracaoMs = Date.now() - inicioMs;
  Object.assign(ambiente, { fimEm, duracaoMs });

  await emitirResultados({ args, variantes, clipes, modeloGlobal, verificacaoModelo, comparabilidade, gateQualidade, ambiente, data, avisos, resultados, inicioEm, fimEm, duracaoMs, backend });
}
