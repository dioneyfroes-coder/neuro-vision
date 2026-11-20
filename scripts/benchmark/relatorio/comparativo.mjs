import { ADAPTADORES_ESPERADOS, LETRAS } from "../constantes.mjs";
import { arredondar, celula, megabytes, num, pct, pctCurto } from "../estatistica.mjs";
import { linhaClipes, linhaCodigo, textoVeredito } from "./formato.mjs";

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
