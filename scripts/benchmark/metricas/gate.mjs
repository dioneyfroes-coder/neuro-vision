import { arredondar, num, pctCurto } from "../estatistica.mjs";

/**
 * Gate de qualidade x latencia (itens 5 e 6 da Fase 5). Diz, por variante, se
 * ela ATINGE os criterios de qualidade definidos previamente e se o ganho de F1
 * sobre a referencia compensa o custo de latencia. C/D so ficam "promoviveis a
 * padrao" quando:
 *   1. F1 >= minF1 e FP/min <= maxFpMin (criterio de qualidade);
 *   2. o ganho de F1 sobre a melhor referencia (A/B) >= ganhoMinimoF1;
 *   3. o total mediano nao passa de `custoMaximoLatencia` vezes o da referencia.
 * Caso contrario a recomendacao e "manter experimental". Sem qualidade
 * consolidada ou sem dados de latencia, a variante fica "sem dados" — nunca
 * promovida.
 */
export function avaliarGateQualidade(resultados, criterios = {}) {
  const {
    minF1 = 0.5,
    maxFpMin = 2,
    ganhoMinimoF1 = 0.1,
    custoMaximoLatencia = 1.5,
  } = criterios;

  const dados = resultados.map((r) => {
    const c = r.qualidade?.consolidado ?? null;
    // Gate usa o regime AQUECIDO quando existe: warm-up nao representa o
    // desempenho que seria promovido a padrao.
    const desempenhoValido = r.desempenhoAquecido ?? r.desempenho;
    const m = desempenhoValido?.metricas ?? {};
    return {
      letra: r.variante.letra,
      f1: c?.f1 ?? null,
      precisao: c?.precisao ?? null,
      recall: c?.recall ?? null,
      falsosPositivosPorMinuto: c?.falsosPositivosPorMinuto ?? null,
      totalMedianaMs: m.totalMs?.medianaMs ?? null,
      ciclosConcluidos: desempenhoValido?.ciclosConcluidos ?? 0,
    };
  });

  // Referencia de latencia/qualidade: a MELHOR variante de referencia (A ou B)
  // com qualidade. Se nenhuma referencia tiver dados, usa a media das demais.
  const referencias = dados.filter(
    (d) => (d.letra === "A" || d.letra === "B") && d.f1 !== null && d.totalMedianaMs !== null
  );
  const refF1 = referencias.length ? Math.max(...referencias.map((d) => d.f1)) : null;
  const refTotal = referencias.length
    ? Math.min(...referencias.map((d) => d.totalMedianaMs))
    : null;

  const porVariante = dados.map((d) => {
    const motivos = [];
    const temDados = d.f1 !== null && d.totalMedianaMs !== null;
    if (!temDados) {
      if (d.f1 === null) motivos.push("sem qualidade consolidada");
      if (d.totalMedianaMs === null) motivos.push("sem latencia total medida");
      return { ...d, atende: false, promovivel: false, motivo: motivos.join("; ") };
    }
    const atendeF1 = d.f1 >= minF1;
    const atendeFp = d.falsosPositivosPorMinuto === null || d.falsosPositivosPorMinuto <= maxFpMin;
    if (!atendeF1) motivos.push(`F1 ${pctCurto(d.f1)} abaixo do minimo ${pctCurto(minF1)}`);
    if (!atendeFp)
      motivos.push(`FP/min ${num(d.falsosPositivosPorMinuto)} acima do maximo ${num(maxFpMin)}`);
    const atende = atendeF1 && atendeFp;

    // Ganho de qualidade x custo de latencia (so faz sentido para C/D, que
    // acrescentam dados locais/temporal sobre a referencia).
    let ganhoF1 = null;
    let taxaCusto = null;
    let compensa = true;
    if (refF1 !== null) {
      ganhoF1 = arredondar(d.f1 - refF1, 3);
      if (ganhoF1 < ganhoMinimoF1) {
        compensa = false;
        motivos.push(`ganho de F1 (${pctCurto(ganhoF1)}) abaixo do minimo ${pctCurto(ganhoMinimoF1)}`);
      }
    }
    if (refTotal !== null && refTotal > 0) {
      taxaCusto = arredondar(d.totalMedianaMs / refTotal, 3);
      if (taxaCusto > custoMaximoLatencia) {
        compensa = false;
        motivos.push(
          `latencia ${num(taxaCusto)}x a referencia, acima do teto ${num(custoMaximoLatencia)}x`
        );
      }
    }

    const promovivel = atende && compensa;
    if (promovivel && !motivos.length) motivos.push("atende aos criterios de qualidade e compensa o custo");
    return { ...d, atende, ganhoF1, taxaCusto, compensa, promovivel, motivo: motivos.join("; ") };
  });

  const experimentais = porVariante.filter((p) => !p.promovivel).map((p) => p.letra);
  return {
    criterios: { minF1, maxFpMin, ganhoMinimoF1, custoMaximoLatencia },
    referencia: { letra: referencias.map((r) => r.letra).join("/") || null, f1: refF1, totalMedianaMs: refTotal },
    porVariante,
    /** Variantes que NAO devem ser promovidas a padrao com estes dados. */
    experimentais,
  };
}
