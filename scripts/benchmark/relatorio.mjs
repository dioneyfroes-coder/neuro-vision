import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ADAPTADORES_ESPERADOS, ARQUIVO_IMUTAVEL, ETAPAS_MS, LETRAS, PADRAO_RELATORIO, ROOT } from "./constantes.mjs";
import { arredondar, celula, f1, intervaloConfiancaMediana, megabytes, num, pct, pctCurto } from "./estatistica.mjs";

/**
 * Grava um relatorio somente se o nome seguir o padrao
 * RELATORIO_VARIANTE_<letra>_* / COMPARATIVO_* e nunca se for (ou apontar
 * para) BASELINE.md.
 */
export async function gravarRelatorioSeguro(dir, nome, conteudo) {
  const alvo = path.resolve(ROOT, dir, nome);
  if (path.basename(alvo).toUpperCase() === ARQUIVO_IMUTAVEL.toUpperCase()) {
    throw new Error(`recusei gravar em ${nome}: ${ARQUIVO_IMUTAVEL} e imutavel`);
  }
  if (!PADRAO_RELATORIO.test(path.basename(alvo))) {
    throw new Error(`nome de relatorio fora do padrao RELATORIO_VARIANTE_*/COMPARATIVO_*: ${nome}`);
  }
  await mkdir(path.dirname(alvo), { recursive: true });
  await writeFile(alvo, conteudo, "utf8");
  return alvo;
}

export function linhaConfiguracao(v) {
  return [
    `imagens: ${v.imagens}`,
    `percepção local: ${v.percepcaoLocal ? "sim" : "não"}`,
    `dados locais no multimodal: ${v.dadosLocais ? "sim" : "não"}`,
    `temporal: ${v.temporal}`,
  ].join(" | ");
}

export function tabelaDesempenho(desempenho) {
  if (!desempenho || !desempenho.ciclos) return ["_Sem registros em `logs/ciclos.jsonl` para esta variante._", ""];
  const linhas = [
    "| Etapa | Mediana (ms) | P95 (ms) | Amostras | IC95% da mediana |",
    "|-------|-------------:|---------:|---------:|------------------|",
  ];
  const nomes = {
    capturaMs: "captura",
    deteccaoMs: "detecção",
    poseMs: "pose",
    maosMs: "mãos",
    temporalMs: "temporal",
    multimodalMs: "multimodal",
    persistenciaMs: "persistência",
    percepcaoTotalMs: "percepção total (4 snapshots)",
    latenciaAteRespostaMultimodalMs: "até resposta multimodal",
    latenciaEntreCiclosMs: "entre ciclos",
    totalMs: "TOTAL do ciclo",
  };
  for (const etapa of ETAPAS_MS) {
    const m = desempenho.metricas[etapa];
    const ic = m.intervaloConfiancaMediana
      ? `[${m.intervaloConfiancaMediana.inferiorMs}, ${m.intervaloConfiancaMediana.superiorMs}]`
      : m.amostras
        ? "N/A (n<10)"
        : "N/A";
    linhas.push(
      `| ${nomes[etapa]} | ${m.medianaMs ?? "—"} | ${m.p95Ms ?? "—"} | ${m.amostras} | ${ic} |`
    );
  }
  linhas.push("");
  const erros = Object.entries(desempenho.errosPorEtapa)
    .map(([e, q]) => `${e}: ${q}`)
    .join(", ");
  linhas.push(
    `- Ciclos: **${desempenho.ciclos}** (mediana de ${desempenho.framesPorCiclo ?? "—"} frames/ciclo) · ` +
      `**concluídos: ${desempenho.ciclosConcluidos}** · observações: ${desempenho.observacoes} · eventos temporais: ${desempenho.eventosTemporais}`
  );
  linhas.push(
    `- Ciclos completos: **${desempenho.ciclosCompletos ?? desempenho.ciclosConcluidos}** · ` +
      `incompletos: **${desempenho.ciclosIncompletos ?? 0}** · ` +
      `cancelados: **${desempenho.cancelados}** · ` +
      `com subsistema indisponível: **${desempenho.ciclosComSubsistemaIndisponivel ?? 0}**`
  );
  linhas.push(
    `- Ciclos com erro: **${desempenho.ciclosComErro}**${erros ? ` (${erros})` : ""}`
  );
  const subs = Object.entries(desempenho.subsistemasIndisponiveis)
    .map(([s, q]) => `${s}: ${q}`)
    .join(", ");
  linhas.push(`- Subsistemas indisponíveis: ${subs || "nenhum"}`);
  linhas.push("");
  linhas.push(...tabelaCustosDetalhados(desempenho));
  return linhas;
}

/**
 * Tabelas de custo separadas por regime (P3.1): inferencia aquecida por
 * snapshot, carga fria por modelo e memoria maxima. Sao deliberadamente
 * distintas do `totalMs`: misturar inicializacao, inferencia e espera de
 * captura produz uma media sem significado.
 */
export function tabelaCustosDetalhados(desempenho) {
  const linhas = [];
  const inferencia = Object.entries(desempenho.inferenciaPorSnapshot ?? {});
  if (inferencia.length) {
    linhas.push("**Custo aquecido de inferência por snapshot:**", "");
    linhas.push(
      "| Subsistema | Mediana (ms) | P95 (ms) | Máximo (ms) | Amostras |",
      "|------------|-------------:|---------:|------------:|---------:|"
    );
    for (const [subsistema, m] of inferencia) {
      linhas.push(
        `| ${subsistema} | ${m.medianaMs ?? "—"} | ${m.p95Ms ?? "—"} | ${m.maximoMs ?? "—"} | ${m.amostras} |`
      );
    }
    linhas.push("");
  }

  const memoria = desempenho.memoriaMaxima;
  if (memoria?.amostras) {
    linhas.push(
      `- **Memória máxima (heap):** mediana ${megabytes(memoria.medianaBytes) ?? "—"} MB · ` +
        `P95 ${megabytes(memoria.p95Bytes) ?? "—"} MB · pico ${megabytes(memoria.maximoBytes) ?? "—"} MB ` +
        `(${memoria.amostras} amostra(s))`
    );
  }

  const carga = desempenho.cargaModelos;
  if (carga) {
    linhas.push(
      `- **Carga fria da sessão:** mediana ${carga.totalMs?.medianaMs ?? "—"} ms · ` +
        `P95 ${carga.totalMs?.p95Ms ?? "—"} ms (${carga.totalMs?.amostras ?? 0} sessão(ões) medida(s))`
    );
    const subsistemas = Object.entries(carga.subsistemas ?? {});
    const adaptadores = [
      ...new Set([...ADAPTADORES_ESPERADOS, ...subsistemas.map(([chave]) => chave)]),
    ];
    linhas.push(
      "",
      "| Adaptador | Modelo | Dispositivo efetivo | Versão | Carga mediana (ms) | P95 (ms) |",
      "|-----------|--------|---------------------|--------|-------------------:|---------:|"
    );
    for (const adaptador of adaptadores) {
      const c = carga.subsistemas?.[adaptador];
      linhas.push(
        `| ${adaptador} | ${c?.modelo ?? "não registrado"} | ${c?.dispositivo ?? "não registrado"} | ${c?.versao ?? "—"} | ${c?.tempoCargaMs?.medianaMs ?? "—"} | ${c?.tempoCargaMs?.p95Ms ?? "—"} |`
      );
    }
    linhas.push("");
  }
  return linhas;
}

export function tabelaQualidade(qualidade) {
  if (!qualidade || !qualidade.porClip?.length) return ["_Sem avaliação de qualidade (sem anotações ou sem arquivo de eventos)._", ""];
  const linhas = [
    "| Clipe | Eventos | Precisão | Recall | F1 | FP/min | Não detectados | Sem classificação | Dist. média casamento |",
    "|-------|---------|---------:|-------:|---:|-------:|---------------:|------------------:|----------------------:|",
  ];
  for (const p of qualidade.porClip) {
    if (p.pulado) {
      linhas.push(`| ${p.clipe} | — | pulado | pulado | pulado | pulado | pulado | pulado | ${p.motivo} |`);
      continue;
    }
    linhas.push(
      `| ${p.clipe} | \`${p.arquivoEventos}\` | ${pct(p.precisao)} | ${pct(p.recall)} | ${pct(p.f1)} | ${num(p.falsosPositivosPorMinuto)} | ${p.perdidos} | ${p.semClassificacaoEscopo} | ${p.distanciaMediaMs ?? "—"} ms |`
    );
  }
  linhas.push("");
  const c = qualidade.consolidado;
  if (c) {
    linhas.push(
      `**Consolidado (${c.clipes}/${c.clipesEsperados} clipe(s))**: precisão ${pct(c.precisao)} · recall ${pct(c.recall)} · ` +
        `F1 ${pct(c.f1)} · FP/min ${num(c.falsosPositivosPorMinuto)} · não detectados ${c.eventosNaoDetectados} · ` +
        `movimentos sem classificação de escopo ${c.semClassificacaoEscopo} · ` +
        `distância média de casamento ${c.distanciaMediaMs ?? "—"} ms`
    );
    linhas.push("");
  }
  return linhas;
}

/** Linha de versao do codigo (commit/branch) para os relatorios. */
export function linhaCodigo(ambiente) {
  const c = ambiente.codigo;
  if (!c?.commit) return "indisponível (fora de um repositório Git)";
  return `${c.branch || "?"} @ ${c.commit.slice(0, 12)}${c.alteracoesLocais ? " (alterações locais)" : " (limpo)"}`;
}

/** Clipes com hash — prova de que todas as variantes usaram os mesmos bytes. */
export function linhaClipes(clipes) {
  if (!clipes.length) return "(nenhum)";
  return clipes
    .map((c) => {
      const hash = c.sha256 ? `sha256:${c.sha256.slice(0, 12)}…` : "sem hash";
      const bytes = Number.isFinite(c.tamanhoBytes) ? `${c.tamanhoBytes} bytes` : "tamanho ?";
      return `${c.nome} (${hash}, ${bytes}, anotação: ${c.anotacao ?? "ausente"})`;
    })
    .join("; ");
}

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

/** Texto do veredito separando comparabilidade de suficiencia estatistica. */
export function textoVeredito(comparabilidade) {
  if (!comparabilidade.comparavel) {
    return "⚠️ **INCONCLUSIVO** — dados não comparáveis; não use os números para decidir entre variantes";
  }
  if (!comparabilidade.estatisticamenteSuficiente) {
    const minimo = comparabilidade.minAmostrasEstatisticas ?? 10;
    return (
      "⚠️ **COMPARÁVEL, MAS ESTATISTICAMENTE INSUFICIENTE** — os dados são válidos para diagnóstico, " +
      `mas cada variante precisa de pelo menos ${minimo} ciclo(s) concluído(s) no regime aquecido para um ` +
      "intervalo de confiança não trivial. Não trate esta rodada como resultado conclusivo."
    );
  }
  return "✅ **CONCLUSIVO** — dados comparáveis e amostra estatisticamente suficiente";
}

export function gerarComparativo({ variantes, resultados, clipes, modelo, verificacaoModelo, comparabilidade, gateQualidade, ambiente, data, avisos }) {
  const nomeConjunto = LETRAS.filter((l) => variantes.some((v) => v.letra === l)).join("_");
  const L = [
    `# Comparativo arquitetural ${nomeConjunto.split("_").join(" × ")} — ${data}`,
    "",
    `- **Veredito:** ${textoVeredito(comparabilidade)}`,
    `- **Conjunto reservado:** ${ambiente.conjunto ?? "(não informado — use --conjunto <nome>)"}`,
    `- **Warm-up excluído das medianas:** ${ambiente.warmups ?? 0} ciclo(s) concluído(s) por variante`,
    `- **Clipes (idênticos em todas as variantes):** ${linhaClipes(clipes)}`,
    `- **Modelo multimodal (registrado):** ${modelo || "(não informado)"}`,
    `- **Código:** ${linhaCodigo(ambiente)}`,
    `- **Backend multimodal:** ${ambiente.backend ?? "(não informado)"}`,
    `- **Hardware:** ${ambiente.cpu} · ${ambiente.nucleosLogicos} núcleos · ${arredondar(ambiente.memoriaTotalBytes / 1024 ** 3, 1)} GB RAM · ${ambiente.plataforma} · Node ${ambiente.node}`,
    `- **Janela de geração do relatório (wall-clock do harness, não é a duração das inferências):** ${ambiente.inicioEm ?? "?"} → ${ambiente.fimEm ?? "?"}` +
      `${Number.isFinite(ambiente.duracaoMs) ? ` (${(ambiente.duracaoMs / 1000).toFixed(1)} s)` : ""}`,
    `- **Critério de comparabilidade:** ao menos ${ambiente.minCiclosValidos ?? 2} ciclo(s) concluído(s) por variante **no regime aquecido**, modelo multimodal verificado em \`logs/visao.jsonl\` e um arquivo de eventos próprio por variante.`,
    `- **Critério de suficiência estatística:** ao menos ${ambiente.minAmostrasEstatisticas ?? 10} ciclo(s) concluído(s) por variante no regime aquecido (mínimo para IC95% da mediana por ordem estatística).`,
    `- Gerado em ${ambiente.dataHora}. O \`bench/BASELINE.md\` permanece intocado.`,
    "",
  ];

  if (!comparabilidade.comparavel) {
    L.push("## Por que este comparativo é inconclusivo", "");
    for (const p of comparabilidade.problemas) L.push(`- ⚠️ ${p}`);
    L.push("");
  } else if (!comparabilidade.estatisticamenteSuficiente) {
    L.push("## Por que este comparativo não é conclusivo", "");
    L.push(
      "Os dados são **comparáveis** (amostras válidas, modelo verificado e qualidade própria), " +
        "mas a amostra é **estatisticamente insuficiente**. Use os números como diagnóstico, não como prova."
    );
    L.push("");
    for (const p of comparabilidade.limitacoesEstatisticas) L.push(`- ⚠️ ${p}`);
    L.push("");
  }

  L.push(
    "## Matriz de configuração",
    "",
    "| Variante | Modo | Imagens | Percepção local | Dados locais | Temporal | Objetivo |",
    "|----------|------|--------:|:---------------:|:------------:|----------|----------|"
  );
  for (const v of variantes) {
    L.push(
      `| ${v.letra} | \`${celula(v.modo)}\` | ${v.imagens} | ${v.percepcaoLocal ? "sim" : "não"} | ${v.dadosLocais ? "sim" : "não"} | ${v.temporal} | ${v.objetivo} |`
    );
  }
  L.push("");

  L.push("## Desempenho (mediana / P95 por variante, regime aquecido)", "");
  L.push(
    "| Variante | Ciclos | Concluídos | Warm-ups | Cold start total (ms) | Total med (ms) | Total P95 (ms) | Multimodal med (ms) | Temporal med (ms) | Deteccão med (ms) | Erros | Cancelados |",
    "|----------|-------:|-----------:|---------:|----------------------:|---------------:|---------------:|--------------------:|------------------:|------------------:|------:|-----------:|"
  );
  for (const { variante, desempenho, desempenhoAquecido, coldStart, warmups } of resultados) {
    const valido = desempenhoAquecido ?? desempenho;
    const m = valido?.metricas ?? {};
    L.push(
      `| ${variante.letra} | ${valido?.ciclos ?? 0} | ${valido?.ciclosConcluidos ?? 0} | ${warmups ?? 0} | ${coldStart?.metricas.totalMs.medianaMs ?? "—"} | ${m.totalMs?.medianaMs ?? "—"} | ${m.totalMs?.p95Ms ?? "—"} | ${m.multimodalMs?.medianaMs ?? "—"} | ${m.temporalMs?.medianaMs ?? "—"} | ${m.deteccaoMs?.medianaMs ?? "—"} | ${valido?.ciclosComErro ?? 0} | ${valido?.cancelados ?? 0} |`
    );
  }
  L.push("");

  // Custos separados por regime (P3.1): cold start, inferencia aquecida por
  // snapshot, conjunto de 4 snapshots, resposta multimodal, intervalo entre
  // ciclos, memoria e cobertura de desfechos.
  L.push("## Custos por regime e cobertura de ciclos (P3.1)", "");
  L.push(
    "| Variante | Percepção 4 snapshots med (ms) | Até multimodal med (ms) | Entre ciclos med (ms) | Memória pico (MB) | Completos | Incompletos | Cancelados | Subsistema indisponível |",
    "|----------|------------------------------:|------------------------:|----------------------:|------------------:|----------:|------------:|-----------:|-------------------------:|"
  );
  for (const { variante, desempenhoAquecido, desempenho } of resultados) {
    const valido = desempenhoAquecido ?? desempenho;
    const m = valido?.metricas ?? {};
    const memoria = valido?.memoriaMaxima;
    L.push(
      `| ${variante.letra} | ${m.percepcaoTotalMs?.medianaMs ?? "—"} | ${m.latenciaAteRespostaMultimodalMs?.medianaMs ?? "—"} | ${m.latenciaEntreCiclosMs?.medianaMs ?? "—"} | ${megabytes(memoria?.maximoBytes) ?? "—"} | ${valido?.ciclosCompletos ?? valido?.ciclosConcluidos ?? 0} | ${valido?.ciclosIncompletos ?? 0} | ${valido?.cancelados ?? 0} | ${valido?.ciclosComSubsistemaIndisponivel ?? 0} |`
    );
  }
  L.push("");

  // Backend, modelo multimodal e dispositivos efetivos dos adaptadores (item 55
  // da Fase 5): lista os tres adaptadores mesmo quando a telemetria de carga
  // nao os registrou — ausencia vira "nao registrado", nunca um dispositivo
  // inventado.
  L.push("## Backend, modelo multimodal e dispositivos efetivos dos adaptadores", "");
  L.push(
    `- **Backend multimodal:** ${ambiente.backend ?? "(não informado)"}`,
    `- **Modelo multimodal (registrado):** ${modelo || "(não informado)"}`,
    `- **Modelo multimodal (observado em visao.jsonl):** ${verificacaoModelo?.modelos?.length ? verificacaoModelo.modelos.join(", ") : "(não verificável)"}`
  );
  L.push("");
  L.push(
    "| Variante | Adaptador | Modelo local | Dispositivo efetivo | Versão | Carga mediana (ms) | P95 (ms) |",
    "|----------|-----------|--------------|---------------------|--------|-------------------:|---------:|"
  );
  for (const { variante, desempenhoAquecido, desempenho } of resultados) {
    const carga = (desempenhoAquecido ?? desempenho)?.cargaModelos ?? null;
    const adaptadores = [
      ...new Set([...ADAPTADORES_ESPERADOS, ...Object.keys(carga?.subsistemas ?? {})]),
    ];
    for (const adaptador of adaptadores) {
      const c = carga?.subsistemas?.[adaptador];
      L.push(
        `| ${variante.letra} | ${adaptador} | ${c?.modelo ?? "não registrado"} | ${c?.dispositivo ?? "não registrado"} | ${c?.versao ?? "—"} | ${c?.tempoCargaMs?.medianaMs ?? "—"} | ${c?.tempoCargaMs?.p95Ms ?? "—"} |`
      );
    }
  }
  L.push("");

  // Etapas isoladas x ciclo completo (somente quando solicitado por variante).
  const comEtapas = resultados.filter((r) => r.etapasIsoladas);
  if (comEtapas.length) {
    L.push("## Etapas isoladas × ciclo completo (mediana por ciclo)", "");
    L.push(
      "| Variante | Soma local (ms) | Ciclo completo (ms) | Multimodal (ms) | Etapas sem amostra |",
      "|----------|----------------:|--------------------:|----------------:|--------------------|"
    );
    for (const { variante, etapasIsoladas } of comEtapas) {
      L.push(
        `| ${variante.letra} | ${etapasIsoladas.somaLocalMedianaMs ?? "—"} | ${etapasIsoladas.totalMedianaMs ?? "—"} | ${etapasIsoladas.multimodalMedianaMs ?? "—"} | ${etapasIsoladas.ausentes.join(", ") || "nenhuma"} |`
      );
    }
    L.push("");
  }

  L.push("## Qualidade (consolidado por variante)", "");
  L.push(
    "| Variante | Precisão | Recall | F1 | FP/min | Não detectados | Dist. média casamento |",
    "|----------|---------:|-------:|---:|-------:|---------------:|----------------------:|"
  );
  for (const { variante, qualidade } of resultados) {
    const c = qualidade?.consolidado;
    if (!c) {
      L.push(`| ${variante.letra} | — | — | — | — | — | sem avaliação |`);
      continue;
    }
    L.push(
      `| ${variante.letra} | ${pct(c.precisao)} | ${pct(c.recall)} | ${pct(c.f1)} | ${num(c.falsosPositivosPorMinuto)} | ${c.eventosNaoDetectados} | ${c.distanciaMediaMs ?? "—"} ms |`
    );
  }
  L.push("");

  // Gate de qualidade x latencia (Fase 5, itens 5 e 6): decide se C/D podem ser
  // promovidas a padrao ou devem permanecer experimentais com estes dados.
  if (gateQualidade && !ambiente.semQualidade) {
    const c = gateQualidade.criterios;
    L.push("## Gate de qualidade × latência (decisão de promoção)", "");
    L.push(
      `Critérios definidos previamente: **F1 ≥ ${pct(c.minF1)}** · **FP/min ≤ ${num(c.maxFpMin)}** · ` +
        `**ganho de F1 ≥ ${pct(c.ganhoMinimoF1)}** sobre a referência (${gateQualidade.referencia.letra ?? "n/d"}) · ` +
        `**latência ≤ ${num(c.custoMaximoLatencia)}×** a referência.`
    );
    L.push("");
    L.push(
      "| Variante | F1 | FP/min | Ganho F1 vs ref | Latência vs ref | Qualidade | Compensa | Recomendação |",
      "|----------|----|-------:|----------------:|----------------:|:---------:|:--------:|--------------|"
    );
    for (const g of gateQualidade.porVariante) {
      L.push(
        `| ${g.letra} | ${g.f1 === null ? "—" : pct(g.f1)} | ${g.falsosPositivosPorMinuto === null ? "—" : num(g.falsosPositivosPorMinuto)} | ` +
          `${g.ganhoF1 === null ? "—" : pctCurto(g.ganhoF1)} | ${g.taxaCusto === null ? "—" : `${num(g.taxaCusto)}×`} | ` +
          `${g.atende ? "✅" : "⚠️"} | ${g.compensa ? "✅" : "⚠️"} | ${g.promovivel ? "**promovível a padrão**" : "manter experimental"} |`
      );
    }
    L.push("");
    if (gateQualidade.experimentais.length) {
      L.push(
        `⚠️ **Manter experimentais com estes dados:** ${gateQualidade.experimentais.join(", ")}. ` +
          "Não promover a padrão sem nova medição que atenda aos critérios acima."
      );
    } else {
      L.push("✅ **Todas as variantes com dados atendem aos critérios.**");
    }
    L.push("");
  }

  // Lideres por criterio: SOMENTE quando o veredito e conclusivo. Em rodada
  // invalida, listar "vencedores" seria repetir o defeito do comparativo de
  // 2026-10-18 (metricas iguais copiadas entre variantes).
  if (!comparabilidade.conclusivo) {
    const motivo = !comparabilidade.comparavel
      ? "a rodada não é comparável (ver problemas acima)"
      : "a amostra não é estatisticamente suficiente para eleger líderes (ver limitações acima)";
    L.push("## Líderes por critério", "");
    L.push(`_Não há líderes: ${motivo}._`);
    L.push("");
  } else {
    const comQualidade = resultados.filter((r) => r.qualidade?.consolidado);
    const comDesempenho = resultados.filter(
      (r) => ((r.desempenhoAquecido ?? r.desempenho)?.ciclosConcluidos ?? 0) > 0
    );
    const desempenhoDe = (r) => r.desempenhoAquecido ?? r.desempenho ?? { metricas: {} };
    const melhor = (lista, fn) => lista.reduce((best, r) => (best === null || fn(r) > fn(best) ? r : best), null);
    const pior = (lista, fn) => lista.reduce((worst, r) => (worst === null || fn(r) < fn(worst) ? r : worst), null);

    L.push("## Líderes por critério (entre variantes com dados)", "");
    if (comQualidade.length) {
      const bF1 = melhor(comQualidade, (r) => r.qualidade.consolidado.f1);
      const bRecall = melhor(comQualidade, (r) => r.qualidade.consolidado.recall);
      const bPrec = melhor(comQualidade, (r) => r.qualidade.consolidado.precisao);
      const bFp = pior(comQualidade, (r) => r.qualidade.consolidado.falsosPositivosPorMinuto);
      const bLat = pior(comQualidade, (r) => r.qualidade.consolidado.distanciaMediaMs ?? Infinity);
      L.push(`- **Maior F1:** ${bF1.variante.letra} (${pct(bF1.qualidade.consolidado.f1)})`);
      L.push(`- **Maior recall:** ${bRecall.variante.letra} (${pct(bRecall.qualidade.consolidado.recall)})`);
      L.push(`- **Maior precisão:** ${bPrec.variante.letra} (${pct(bPrec.qualidade.consolidado.precisao)})`);
      L.push(`- **Menos FP/min:** ${bFp.variante.letra} (${num(bFp.qualidade.consolidado.falsosPositivosPorMinuto)})`);
      L.push(
        `- **Casamento mais próximo do instante real:** ${bLat.variante.letra} (${bLat.qualidade.consolidado.distanciaMediaMs ?? "—"} ms)`
      );
    } else {
      L.push("_Sem dados de qualidade para comparar._");
    }
    if (comDesempenho.length) {
      const bTotal = pior(comDesempenho, (r) => desempenhoDe(r).metricas.totalMs.medianaMs ?? Infinity);
      const bMulti = pior(comDesempenho, (r) => desempenhoDe(r).metricas.multimodalMs.medianaMs ?? Infinity);
      const bErros = pior(comDesempenho, (r) => desempenhoDe(r).ciclosComErro + desempenhoDe(r).cancelados);
      L.push(`- **Menor latência total do ciclo (mediana):** ${bTotal.variante.letra} (${desempenhoDe(bTotal).metricas.totalMs.medianaMs ?? "—"} ms)`);
      L.push(`- **Menor latência multimodal (mediana):** ${bMulti.variante.letra} (${desempenhoDe(bMulti).metricas.multimodalMs.medianaMs ?? "—"} ms)`);
      L.push(`- **Mais robusta (erros + cancelamentos):** ${bErros.variante.letra} (${desempenhoDe(bErros).ciclosComErro + desempenhoDe(bErros).cancelados})`);
    } else {
      L.push("_Sem dados de desempenho para comparar._");
    }
    L.push("");
  }

  // Garantia de mesmo modelo multimodal: SOMENTE visao.jsonl (frameId dos
  // ciclos). O `modelo` dos eventos e o detector local e nao prova nada sobre
  // o multimodal — por isso aparece em coluna separada, apenas informativa.
  L.push("## Modelo multimodal verificado", "");
  if (verificacaoModelo?.modelos?.length) {
    L.push(`Modelos distintos observados em todas as variantes: \`${verificacaoModelo.modelos.join("`, `")}\``);
    L.push("");
  }
  L.push(
    "| Variante | Modelo(s) multimodal em visao.jsonl | Detector local nos eventos (não é o multimodal) |",
    "|----------|--------------------------------------|--------------------------------------------------|"
  );
  for (const { variante, modelos } of resultados) {
    const vis = (modelos?.visao ?? []).join(", ") || "—";
    const det = (modelos?.deteccao ?? []).join(", ") || "—";
    L.push(`| ${variante.letra} | ${vis} | ${det} |`);
  }
  L.push("");
  if (verificacaoModelo?.consistente && verificacaoModelo?.modelos?.length) {
    L.push("✅ **Mesmo modelo multimodal confirmado para todas as variantes com dados.**");
  } else {
    L.push("⚠️ **Mesmo modelo multimodal NÃO confirmado** — ver problemas/avisos.");
  }
  L.push("");

  L.push("## Cuidados de comparação", "");
  L.push("- Todos os números acima derivam do **mesmo conjunto de clipes**; a variação entre execuções vem do modelo e do hardware, não dos clipes.");
  L.push(
    `- **Conjunto reservado:** ${ambiente.conjunto ?? "não informado (use --conjunto <nome>)"} — o conjunto de avaliação final deve ser separado do conjunto de ajuste (tuning).`
  );
  L.push(
    `- **Warm-up:** ${ambiente.warmups ?? 0} ciclo(s) concluído(s) por variante foram excluídos das medianas; compare no campo "Cold start" o custo de partida.`
  );
  if (modelo) {
    L.push(`- Modelo multimodal registrado: \`${modelo}\`. Confirme no app que **todas** as variantes rodaram com esta versão.`);
  } else {
    L.push("- ⚠️ Nenhuma versão de modelo foi registrada (`--modelo-visao`); valide manualmente que todas as variantes usaram o mesmo modelo.");
  }
  if (avisos.length) {
    L.push("- Avisos desta rodada:");
    for (const a of avisos) L.push(`  - ⚠️ ${a}`);
  }
  L.push("- Este comparativo é um artefato novo (`COMPARATIVO_*`); `bench/BASELINE.md` não é alterado por este script.");
  L.push("");
  return { conteudo: L.join("\n"), nome: `COMPARATIVO_${nomeConjunto}_${data}.md` };
}
