import { ETAPAS_LOCAIS } from "../constantes.mjs";
import { arredondar, mediana, percentil, somaSegura } from "../estatistica.mjs";

/**
 * Mede cada etapa local ISOLADAMENTE (item 3 da Fase 5) a partir das metricas
 * reais de `logs/ciclos.jsonl`. Por etapa devolve mediana/P95/maximo/amostras e
 * quanto ela representa do `totalMs` mediano observado. Tambem compara a SOMA
 * das etapas locais com o total do ciclo, para expor o que fica de fora
 * (ex.: multimodal, persistencia) — sem inventar nenhum numero.
 *
 * `cobertura`: fracao dos ciclos que registraram a etapa. Etapa ausente (ex.:
 * maos quando o subsistema esta indisponivel) vem com `amostras: 0` e fica
 * marcada em `ausentes`, em vez de virar zero silencioso.
 */
export function agregarEtapasIsoladas(registros) {
  const ciclos = registros.length;
  const etapas = ETAPAS_LOCAIS.map((etapa) => {
    const valores = registros
      .map((r) => Number(r?.metricas?.[etapa]))
      .filter((n) => Number.isFinite(n) && n > 0);
    return {
      etapa,
      amostras: valores.length,
      medianaMs: arredondar(mediana(valores)),
      p95Ms: arredondar(percentil(valores, 0.95)),
      maximoMs: valores.length ? arredondar(Math.max(...valores)) : null,
      cobertura: ciclos ? arredondar(valores.length / ciclos, 3) : null,
    };
  });

  const ausentes = etapas.filter((e) => e.amostras === 0).map((e) => e.etapa);

  // Totais por ciclo: soma das etapas locais presentes x totalMs real.
  const totais = registros
    .map((r) => {
      const locais = ETAPAS_LOCAIS.map((etapa) => Number(r?.metricas?.[etapa])).filter(
        (n) => Number.isFinite(n) && n > 0
      );
      const total = Number(r?.metricas?.totalMs);
      if (!locais.length || !Number.isFinite(total) || total <= 0) return null;
      return { locais: somaSegura(locais), total, multimodal: Number(r?.metricas?.multimodalMs) };
    })
    .filter(Boolean);

  return {
    ciclos,
    etapas,
    ausentes,
    /** Mediana da soma das etapas locais por ciclo (o "ciclo local"). */
    somaLocalMedianaMs: arredondar(mediana(totais.map((t) => t.locais))),
    /** Mediana do totalMs real do ciclo (o ciclo completo). */
    totalMedianaMs: arredondar(mediana(totais.map((t) => t.total))),
    /** Mediana do multimodal (o que sobra entre o ciclo local e o completo). */
    multimodalMedianaMs: arredondar(
      mediana(totais.map((t) => t.multimodal).filter((n) => Number.isFinite(n) && n > 0))
    ),
    amostras: totais.length,
  };
}
