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
