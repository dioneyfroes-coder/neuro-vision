import { ETAPAS_MS, SUBSISTEMAS_METRICA } from "../constantes.mjs";
import { arredondar, intervaloConfiancaMediana, mediana, percentil, somaSegura } from "../estatistica.mjs";

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
