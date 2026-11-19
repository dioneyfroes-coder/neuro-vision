/** Relatorio Markdown legivel do resumo. */
export function formatarMarkdown(resumo) {
  const linhas = [];
  linhas.push("# Benchmark de cadencia da percepcao", "");
  linhas.push(`- Politica: \`${resumo.politica ?? "todas"}\``);
  linhas.push(`- Ciclos analisados: ${resumo.ciclos}${resumo.suficiente ? "" : " (amostra insuficiente)"}`);
  linhas.push(`- Alvo de maos: ${resumo.fpsAlvo} FPS`);
  linhas.push(`- Veredito: ${resumo.veredito ? "**ATINGIU**" : "**NAO ATINGIU**"}`);
  linhas.push(`- Gerado em: ${resumo.geradoEm}`, "");
  linhas.push("## Amostragem por subsistema", "");
  linhas.push(
    "| Subsistema | Ciclos | Frames | Amostrados | Cobertura | Alvo (FPS) | Efetivo (FPS) | Maximo (FPS) | Intervalo medio (ms) | Atingiu |"
  );
  linhas.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const [nome, resumoSub] of Object.entries(resumo.amostragem.porSubsistema)) {
    linhas.push(
      `| ${nome} | ${resumoSub.ciclos} | ${resumoSub.frames} | ${resumoSub.amostrados} | ` +
        `${resumoSub.cobertura ?? "-"} | ${resumoSub.fpsAlvo ?? "-"} | ${resumoSub.fpsEfetivo ?? "-"} | ` +
        `${resumoSub.fpsEfetivoMaximo ?? "-"} | ${resumoSub.intervaloMedioMs ?? "-"} | ` +
        `${resumoSub.atingiu === null ? "-" : resumoSub.atingiu ? "sim" : "nao"} |`
    );
  }
  linhas.push("", "## Latencia por etapa (ms)", "");
  linhas.push("| Etapa | Amostras | Mediana | P95 |");
  linhas.push("| --- | --- | --- | --- |");
  for (const [etapa, resumoEtapa] of Object.entries(resumo.latencia)) {
    if (!resumoEtapa.amostras) continue;
    linhas.push(`| ${etapa} | ${resumoEtapa.amostras} | ${resumoEtapa.mediana} | ${resumoEtapa.p95} |`);
  }
  linhas.push("");
  return linhas.join("\n");
}
