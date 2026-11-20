import { ADAPTADORES_ESPERADOS, ETAPAS_MS } from "../../constantes.mjs";
import { megabytes, pct } from "../../estatistica.mjs";

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
