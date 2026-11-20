import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ADAPTADORES_ESPERADOS, ARQUIVO_IMUTAVEL, ETAPAS_MS, PADRAO_RELATORIO, ROOT } from "../constantes.mjs";
import { arredondar, celula, megabytes, num, pct, pctCurto } from "../estatistica.mjs";

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
