/**
 * Nucleo do relatorio consolidado de benchmark (Fase 8).
 *
 * Reaproveita as agregacoes ja existentes de variantes A/B/C/D e de cadencia;
 * nao inventa numero nem transforma ausencia de amostra em zero. O veredito
 * `INCONCLUSIVO` e explicito quando faltam dados, e um veredito negativo
 * medido (`NAO_ATINGIU`) e reportado como tal — nao como falta de medicao.
 */

import { VARIANTES_BENCHMARK } from "../benchmark/constantes.mjs";
import {
  filtrarCiclosDaVariante,
  identificarVarianteDoRegistro,
} from "../benchmark/artefatos.mjs";
import {
  agregarMetricasCiclos,
  ehCicloConcluido,
  separarWarmupCiclos,
} from "../benchmark/metricas.mjs";
import { resumirBenchmark } from "../benchmark-cadencia/agregacao.mjs";

const na = (valor) => (valor === null || valor === undefined ? "N/A" : String(valor));
const mediana = (metrica) => (metrica?.amostras > 0 ? metrica.medianaMs : null);
const megabytes = (bytes) => (Number.isFinite(bytes) ? (bytes / 1048576).toFixed(1) : null);

/** Compara as quatro variantes sobre os MESMOS registros de ciclo. */
export function compararVariantes(registros = [], { warmups = 0 } = {}) {
  const concluidos = registros.filter(ehCicloConcluido);
  return VARIANTES_BENCHMARK.map((variante) => {
    const daVariante = filtrarCiclosDaVariante(concluidos, variante.letra);
    const { warmup, aquecido } = separarWarmupCiclos(daVariante, warmups);
    const agregado = agregarMetricasCiclos(aquecido);
    return {
      letra: variante.letra,
      rotulo: variante.rotulo,
      modo: variante.modo,
      ciclosConcluidos: daVariante.length,
      ciclosAquecidos: aquecido.length,
      warmups: warmup.length,
      totalMs: mediana(agregado.metricas.totalMs),
      multimodalMs: mediana(agregado.metricas.multimodalMs),
      cargaModelosMs: agregado.cargaModelos?.totalMs?.medianaMs ?? null,
      memoriaPicoMb: megabytes(agregado.memoriaMaxima?.maximoBytes),
      erros: agregado.ciclosComErro,
      cancelados: agregado.cancelados,
    };
  });
}

/** Resumo que alimenta o relatorio e tambem e emitido em `--json`. */
export function montarRelatorio({
  registros = [],
  soak = null,
  fonte = "logs/ciclos.jsonl",
  minCiclos = 2,
  politica,
  fpsAlvo = 5,
  warmups = 0,
  geradoEm = new Date().toISOString(),
  avisos = [],
} = {}) {
  const variantes = compararVariantes(registros, { warmups });
  const cadencia = resumirBenchmark(registros, { politica, fpsAlvo, minCiclos });
  const comDados = variantes.filter((v) => v.ciclosAquecidos >= minCiclos);

  const faltamDados = [...avisos];
  if (registros.length === 0) {
    faltamDados.push("nenhum registro de ciclo foi lido da fonte informada.");
  }
  if (comDados.length < 2) {
    faltamDados.push(
      `menos de duas variantes com ${minCiclos} ciclo(s) concluído(s) no regime aquecido.`
    );
  }
  if (!cadencia.suficiente) {
    faltamDados.push("amostra insuficiente para avaliar a cadencia com o --min-ciclos informado.");
  }

  const suficiente = faltamDados.length === 0;
  const veredito = !suficiente
    ? "INCONCLUSIVO"
    : cadencia.veredito
      ? "ATINGIU"
      : "NAO_ATINGIU";

  const resumo = {
    geradoEm,
    fonte,
    politica: politica ?? null,
    fpsAlvo,
    minCiclos,
    warmups,
    veredito,
    suficiente,
    faltamDados,
    variantes,
    cadencia,
    soak,
  };
  resumo.markdown = formatarRelatorio(resumo);
  return resumo;
}

/** Markdown legivel; toda ausencia aparece como `N/A`, nunca como zero. */
export function formatarRelatorio(resumo) {
  const L = [
    `# Relatorio consolidado de benchmark — Fase 8 — ${resumo.geradoEm.slice(0, 10)}`,
    "",
    `- **Veredito:** ${resumo.veredito}`,
    `- **Gerado em:** ${resumo.geradoEm}`,
    `- **Fonte de ciclos:** \`${resumo.fonte}\``,
    `- **Politica de cadencia:** ${resumo.politica ?? "(nao informada)"} · alvo ${na(resumo.fpsAlvo)} FPS`,
    `- **Criterio:** ${resumo.minCiclos} ciclo(s) concluido(s) por variante no regime aquecido; ${resumo.warmups} warm-up(s) excluido(s).`,
    `- **Soak:** ${resumo.soak ? `${resumo.soak.veredito ?? "N/A"} (${resumo.soak.data ?? "data nao informada"})` : "nao fornecido — nenhum veredito inferido"}`,
    "",
    "## Variantes (mesmos registros de ciclo)",
    "",
    "| Variante | Modo | Concluidos | Aquecidos | Total med (ms) | Multimodal med (ms) | Carga med (ms) | Memoria pico (MB) | Erros | Cancelados |",
    "|----------|------|-----------:|----------:|---------------:|--------------------:|---------------:|------------------:|------:|-----------:|",
  ];
  for (const v of resumo.variantes) {
    L.push(
      `| ${v.letra} · ${v.rotulo.replace(/^[A-D] · /, "")} | \`${v.modo}\` | ${v.ciclosConcluidos} | ${v.ciclosAquecidos} | ${na(v.totalMs)} | ${na(v.multimodalMs)} | ${na(v.cargaModelosMs)} | ${na(v.memoriaPicoMb)} | ${v.erros} | ${v.cancelados} |`
    );
  }
  L.push("");

  L.push("## Cadencia efetiva (amostragem observada)", "");
  L.push("| Subsistema | Ciclos | FPS alvo | FPS efetivo | Cobertura | Atingiu |", "|------------|-------:|---------:|------------:|----------:|:-------:|");
  for (const [subsistema, s] of Object.entries(resumo.cadencia.amostragem.porSubsistema)) {
    L.push(
      `| ${subsistema} | ${s.ciclos} | ${na(s.fpsAlvo)} | ${na(s.fpsEfetivo)} | ${na(s.cobertura)} | ${s.atingiu === null ? "N/A" : s.atingiu ? "sim" : "nao"} |`
    );
  }
  L.push("");

  if (!resumo.suficiente) {
    L.push("## Por que este relatorio e inconclusivo", "");
    for (const motivo of resumo.faltamDados) L.push(`- ⚠️ ${motivo}`);
    L.push("");
  }

  L.push(
    "## Cuidados",
    "",
    "- Numeros acima vem de registros reais de ciclo; ausencia de amostra permanece `N/A`.",
    "- Este relatorio e gerado automaticamente a partir de logs; ele **nao** substitui execucao em hardware alvo, anotacoes humanas ou clipes rotulados.",
    "- `bench/BASELINE.md` nunca e sobrescrito.",
    ""
  );
  return L.join("\n");
}

/** Identificacao legada (util para diagnosticar registros sem variante explicita). */
export { identificarVarianteDoRegistro };

export const PADRAO_NOME_RELATORIO = /^RELATORIO_FASE8_\d{8}\.md$/;

export function nomeRelatorioFase8(data) {
  if (!/^\d{8}$/.test(String(data))) throw new Error("data deve estar no formato YYYYMMDD");
  return `RELATORIO_FASE8_${data}.md`;
}
