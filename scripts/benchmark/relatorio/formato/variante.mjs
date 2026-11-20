import { arredondar, num, pct, pctCurto } from "../../estatistica.mjs";
import {
  linhaClipes,
  linhaCodigo,
  linhaConfiguracao,
  tabelaDesempenho,
  tabelaQualidade,
} from "./tabelas.mjs";

export function gerarRelatorioVariante({
  variante,
  clipes,
  desempenho,
  coldStart,
  warmups = 0,
  etapasIsoladas,
  qualidade,
  arquivoEventos,
  arquivosEventosPorClipe,
  arquivoCiclos,
  modelos,
  modelo,
  gate,
  ambiente,
  avisos,
  data,
}) {
  const observados = modelos?.visao?.length ? `visao.jsonl [${modelos.visao.join(", ")}]` : null;
  const deteccao = modelos?.deteccao?.length ? modelos.deteccao.join(", ") : null;
  const L = [
    `# Relatório da variante ${variante.letra} — ${data}`,
    "",
    `- **Variante:** ${variante.rotulo}`,
    `- **Modo no app:** \`${variante.modo}\``,
    `- **Configuração:** ${linhaConfiguracao(variante)}`,
    `- **Objetivo:** ${variante.objetivo}`,
    `- **Código:** ${linhaCodigo(ambiente)}`,
    `- **Backend multimodal:** ${ambiente.backend ?? "(não informado)"}`,
    `- **Janela de geração do relatório (wall-clock do harness, não é a duração das inferências):** ${ambiente.inicioEm ?? "?"} → ${ambiente.fimEm ?? "?"}` +
      `${Number.isFinite(ambiente.duracaoMs) ? ` (${(ambiente.duracaoMs / 1000).toFixed(1)} s)` : ""}`,
    `- **Conjunto reservado:** ${ambiente.conjunto ?? "(não informado — use --conjunto <nome>)"}`,
    `- **Clipes (mesmos para todas as variantes):** ${linhaClipes(clipes)}`,
    `- **Modelo multimodal (registrado):** ${modelo || "(não informado — use --modelo-visao para registrar a versão usada)"}`,
    `- **Modelo multimodal (observado em visao.jsonl):** ${observados || "(sem campo `modelo` para os frames dos ciclos — não verificável)"}`,
    `- **Detector local (observado nos eventos):** ${deteccao || "(sem campo `modelo` nos eventos)"} — não é o modelo multimodal`,
    `- **Ciclos:** \`${arquivoCiclos}\` · **Eventos:** ${
      arquivosEventosPorClipe?.length
        ? arquivosEventosPorClipe.map((uso) => `\`${uso.clipe}: ${uso.arquivo}\``).join(", ")
        : `\`${arquivoEventos ?? "(nenhum arquivo)"}\``
    }`,
    `- **Tolerância de casamento:** ${toleranciaRelatorio} ms`,
    `- **Warm-up:** ${warmups} ciclo(s) concluído(s) excluído(s) das medianas (parâmetro \`--warmups\`)`,
    `- **Ambiente:** ${ambiente.cpu} · ${ambiente.nucleosLogicos} núcleos · ${arredondar(ambiente.memoriaTotalBytes / 1024 ** 3, 1)} GB RAM · ${ambiente.plataforma} · Node ${ambiente.node}`,
    `- Gerado por \`scripts/benchmark-variantes.mjs\` em ${ambiente.dataHora}. Este arquivo não substitui \`bench/BASELINE.md\`.`,
    "",
    "## 1. Desempenho (logs/ciclos.jsonl, regime aquecido)",
    "",
    ...tabelaDesempenho(desempenho),
  ];

  const minimoEstatistico = ambiente.minAmostrasEstatisticas ?? 10;
  const concluidos = desempenho?.ciclosConcluidos ?? 0;
  if (concluidos < minimoEstatistico) {
    L.push(
      `- ⚠️ **Amostra estatisticamente insuficiente:** ${concluidos} ciclo(s) concluído(s); ` +
        `o IC95% da mediana exige pelo menos ${minimoEstatistico}. Mediana e P95 descrevem a amostra, ` +
        "mas não provam diferença entre variantes.",
      ""
    );
  }

  if (coldStart) {
    L.push("## 1b. Cold start (primeiro(s) ciclo(s), fora das medianas)", "");
    L.push(
      `Os **${warmups}** primeiro(s) ciclo(s) concluído(s) foram tratados como aquecimento ` +
        "(compilação/carga de modelo). Mediana do ciclo completo no cold start: " +
        `**${coldStart.metricas.totalMs.medianaMs ?? "—"} ms** · detecção ${coldStart.metricas.deteccaoMs.medianaMs ?? "—"} ms · ` +
        `multimodal ${coldStart.metricas.multimodalMs.medianaMs ?? "—"} ms. ` +
        "O regime aquecido é o que vale para decidir arquitetura; o cold start mede o custo de partida.",
      ""
    );
  }

  if (etapasIsoladas) {
    L.push("## 1c. Etapas isoladas × ciclo completo", "");
    L.push(
      "| Etapa | Mediana (ms) | P95 (ms) | Máximo (ms) | Cobertura |",
      "|-------|-------------:|---------:|------------:|----------:|"
    );
    const nomesLocais = {
      capturaMs: "captura",
      deteccaoMs: "detecção",
      poseMs: "pose",
      maosMs: "mãos",
      temporalMs: "temporal",
    };
    for (const e of etapasIsoladas.etapas) {
      L.push(
        `| ${nomesLocais[e.etapa] ?? e.etapa} | ${e.medianaMs ?? "—"} | ${e.p95Ms ?? "—"} | ${e.maximoMs ?? "—"} | ${e.cobertura === null ? "—" : pct(e.cobertura)} |`
      );
    }
    L.push("");
    L.push(
      `- **Soma local (mediana por ciclo):** ${etapasIsoladas.somaLocalMedianaMs ?? "—"} ms · ` +
        `**ciclo completo (mediana):** ${etapasIsoladas.totalMedianaMs ?? "—"} ms · ` +
        `**multimodal (mediana):** ${etapasIsoladas.multimodalMedianaMs ?? "—"} ms`
    );
    L.push(
      `- **Etapas sem amostra (nenhum ciclo registrou):** ${etapasIsoladas.ausentes.join(", ") || "nenhuma"}`
    );
    L.push(
      "- Cada etapa local é medida por si só e depois somada no ciclo; a diferença para o ciclo completo é o multimodal e a persistência."
    );
    L.push("");
  }

  L.push(
    "## 2. Qualidade (npm run qualidade por clipe)",
    "",
    ...tabelaQualidade(qualidade)
  );

  if (gate && !ambiente.semQualidade) {
    L.push("## 2b. Gate de qualidade × latência", "");
    L.push(
      `Critérios: F1 ≥ ${pct(gate.criterios?.minF1 ?? 0.5)} · FP/min ≤ ${num(gate.criterios?.maxFpMin ?? 2)} · ` +
        `ganho de F1 ≥ ${pct(gate.criterios?.ganhoMinimoF1 ?? 0.1)} sobre a referência · ` +
        `latência ≤ ${num(gate.criterios?.custoMaximoLatencia ?? 1.5)}× a referência.`
    );
    L.push("");
    L.push(
      `- **Veredito:** ${gate.promovivel ? "✅ **promovível a padrão**" : "⚠️ **manter experimental**"}`
    );
    if (gate.ganhoF1 !== null) L.push(`- Ganho de F1 sobre a referência: ${pctCurto(gate.ganhoF1)}`);
    if (gate.taxaCusto !== null) L.push(`- Latência total: ${num(gate.taxaCusto)}× a referência`);
    if (gate.motivo) L.push(`- ${gate.motivo}`);
    L.push("");
  }

  L.push(
    "## 3. Observações",
    "",
    ...(avisos.length ? avisos.map((a) => `- ⚠️ ${a}`) : ["- Nenhuma."]),
    ""
  );
  return L.join("\n");
}

let toleranciaRelatorio = 3000; // preenchida em main() para os relatorios

export function definirToleranciaRelatorio(valor) {
  toleranciaRelatorio = valor;
}
