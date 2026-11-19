import { ETAPAS_LOCAIS, ETAPAS_MS, SUBSISTEMAS_METRICA } from "./constantes.mjs";
import { arredondar, f1, intervaloConfiancaMediana, mediana, num, pctCurto, percentil, somaSegura } from "./estatistica.mjs";

/**
 * Ciclo que chegou ao fim COM interpretacao e registro: nao cancelado, com
 * frames e com `concluidoEm`. Um diagnostico parcial/cancelado nao conta como
 * amostra valida para comparar variantes.
 */
export function ehCicloConcluido(registro) {
  return (
    registro?.cancelado !== true &&
    Array.isArray(registro?.frameIds) &&
    registro.frameIds.length > 0 &&
    typeof registro?.concluidoEm === "string" &&
    registro.concluidoEm.length > 0
  );
}

/** Agrega metricas de desempenho de uma lista de `RegistroCiclo`. */
export function agregarMetricasCiclos(registros) {
  const metricas = {};
  for (const etapa of ETAPAS_MS) {
    const valores = registros
      .map((r) => Number(r?.metricas?.[etapa]))
      .filter((n) => Number.isFinite(n) && n > 0);
    metricas[etapa] = {
      medianaMs: arredondar(mediana(valores)),
      p95Ms: arredondar(percentil(valores, 0.95)),
      amostras: valores.length,
      intervaloConfiancaMediana: intervaloConfiancaMediana(valores),
    };
  }

  const errosPorEtapa = {};
  let ciclosComErro = 0;
  for (const r of registros) {
    const erros = Array.isArray(r.erros) ? r.erros : [];
    if (erros.length) ciclosComErro++;
    for (const e of erros) {
      const etapa = typeof e?.etapa === "string" ? e.etapa : "desconhecida";
      errosPorEtapa[etapa] = (errosPorEtapa[etapa] ?? 0) + 1;
    }
  }

  const subsistemas = {};
  for (const r of registros) {
    for (const s of Array.isArray(r.subsistemasIndisponiveis) ? r.subsistemasIndisponiveis : []) {
      subsistemas[s] = (subsistemas[s] ?? 0) + 1;
    }
  }

  // Custo aquecido por snapshot, por subsistema (P3.1). Cada ciclo contribui
  // com a media das inferencias validas daquele subsistema; ausente nao vira 0.
  const inferenciaPorSnapshot = {};
  for (const subsistema of SUBSISTEMAS_METRICA) {
    const valores = registros
      .map((r) => Number(r?.metricas?.inferenciaPorSnapshotMs?.[subsistema]))
      .filter((n) => Number.isFinite(n) && n >= 0);
    if (!valores.length) continue;
    inferenciaPorSnapshot[subsistema] = {
      medianaMs: arredondar(mediana(valores)),
      p95Ms: arredondar(percentil(valores, 0.95)),
      maximoMs: arredondar(Math.max(...valores)),
      amostras: valores.length,
    };
  }

  // Memoria maxima observada por ciclo (heap do processo, quando exposto).
  const memoria = registros
    .map((r) => Number(r?.metricas?.memoriaMaximaBytes))
    .filter((n) => Number.isFinite(n) && n > 0);
  const memoriaMaxima = memoria.length
    ? {
        medianaBytes: arredondar(mediana(memoria)),
        p95Bytes: arredondar(percentil(memoria, 0.95)),
        maximoBytes: arredondar(Math.max(...memoria)),
        amostras: memoria.length,
      }
    : null;

  // Carga fria: o mesmo valor se repete em todos os ciclos da sessao, entao
  // deduplicamos por `sessionId` para nao ponderar por quantidade de ciclos.
  const cargasPorSessao = new Map();
  for (const r of registros) {
    const carga = r?.metricas?.cargaModelos;
    if (!carga) continue;
    const chave = typeof r.sessionId === "string" ? r.sessionId : r.cycleId;
    if (!cargasPorSessao.has(chave)) cargasPorSessao.set(chave, carga);
  }
  const cargas = [...cargasPorSessao.values()];
  const totaisCarga = cargas
    .map((c) => Number(c?.totalMs))
    .filter((n) => Number.isFinite(n) && n >= 0);
  const subsistemasCarga = {};
  for (const subsistema of SUBSISTEMAS_METRICA) {
    const itens = cargas.map((c) => c?.subsistemas?.[subsistema]).filter(Boolean);
    if (!itens.length) continue;
    const tempos = itens
      .map((t) => Number(t.tempoCargaMs))
      .filter((n) => Number.isFinite(n) && n >= 0);
    subsistemasCarga[subsistema] = {
      modelo: itens.find((t) => t.modelo)?.modelo ?? null,
      dispositivo: itens.find((t) => t.dispositivo)?.dispositivo ?? null,
      versao: itens.find((t) => t.versao)?.versao ?? null,
      status: itens[0]?.status ?? null,
      tempoCargaMs: tempos.length
        ? {
            medianaMs: arredondar(mediana(tempos)),
            p95Ms: arredondar(percentil(tempos, 0.95)),
            maximoMs: arredondar(Math.max(...tempos)),
            amostras: tempos.length,
          }
        : null,
    };
  }
  const cargaModelos = cargas.length
    ? {
        sessoes: cargas.length,
        totalMs: totaisCarga.length
          ? {
              medianaMs: arredondar(mediana(totaisCarga)),
              p95Ms: arredondar(percentil(totaisCarga, 0.95)),
              amostras: totaisCarga.length,
            }
          : null,
        subsistemas: subsistemasCarga,
      }
    : null;

  const ciclosCancelados = registros.filter((r) => r?.cancelado === true).length;
  const ciclosCompletos = registros.filter(ehCicloConcluido).length;
  const ciclosComSubsistemaIndisponivel = registros.filter(
    (r) => Array.isArray(r?.subsistemasIndisponiveis) && r.subsistemasIndisponiveis.length > 0
  ).length;

  const soma = (fn) => registros.reduce((acc, r) => acc + (fn(r) ?? 0), 0);
  return {
    ciclos: registros.length,
    /** Amostras validas para comparar: concluidos, nao cancelados. */
    ciclosConcluidos: ciclosCompletos,
    /** Ciclos que chegaram ao fim com frames, `concluidoEm` e sem cancelamento. */
    ciclosCompletos,
    /** Ciclos que terminaram sem cancelamento, mas sem conclusao completa. */
    ciclosIncompletos: registros.length - ciclosCompletos - ciclosCancelados,
    framesPorCiclo: arredondar(mediana(registros.map((r) => r.frameIds?.length ?? r.observacoes ?? 0).filter(Number.isFinite)), 1),
    observacoes: soma((r) => r.observacoes),
    eventosTemporais: soma((r) => r.eventosTemporais),
    ciclosComErro,
    errosPorEtapa,
    cancelados: ciclosCancelados,
    /** Ciclos com pelo menos um subsistema indisponivel em algum frame. */
    ciclosComSubsistemaIndisponivel,
    subsistemasIndisponiveis: subsistemas,
    inferenciaPorSnapshot,
    memoriaMaxima,
    cargaModelos,
    metricas,
  };
}

/**
 * Separa os primeiros `warmups` ciclos CONCLUIDOS de cada variante (aquecimento
 * de modelo/compilacao) do regime aquecido. O warm-up nao entra nas medianas do
 * comparativo; o cold start e reportado a parte, em ensaio proprio (Fase 5, item
 * 2). `warmups = 0` devolve tudo em `aquecido`, preservando o comportamento
 * anterior ao benchmark.
 *
 * A separacao e feita sobre os ciclos CONCLUIDOS e na ordem de `concluidoEm`
 * (ou da lista, se ausente) — um ciclo cancelado no inicio nao conta como
 * amostra de aquecimento.
 */
export function separarWarmupCiclos(registros, warmups = 0) {
  const n = Math.max(0, Math.floor(warmups));
  if (!n) return { warmup: [], aquecido: [...registros] };

  const comIndice = registros.map((r, i) => ({ r, i }));
  const concluidos = comIndice
    .filter(({ r }) => ehCicloConcluido(r))
    .sort((a, b) => {
      const ta = Date.parse(a.r?.concluidoEm ?? "");
      const tb = Date.parse(b.r?.concluidoEm ?? "");
      if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
      return a.i - b.i;
    });

  const indicesWarmup = new Set(concluidos.slice(0, n).map(({ i }) => i));
  const warmup = registros.filter((_, i) => indicesWarmup.has(i));
  const aquecido = registros.filter((_, i) => !indicesWarmup.has(i));
  return { warmup, aquecido };
}

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
