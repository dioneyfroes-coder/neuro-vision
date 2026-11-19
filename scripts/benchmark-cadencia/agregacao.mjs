import { SUBSISTEMAS } from "./constantes.mjs";
import { arredondar, mediana, percentil } from "./estatistica.mjs";
import { aplicarWarmup, ehCicloUtil, filtrarPorPolitica } from "./filtros.mjs";

/**
 * Agrega as metricas de amostragem de todos os ciclos.
 *
 * Para cada subsistema devolve: ciclos com amostragem, total de frames do plano,
 * amostrados, cobertura (amostrados/frames), FPS efetivo (mediana dos ciclos que
 * o registraram), intervalo alvo e FPS alvo derivado do intervalo.
 */
export function agregarAmostragem(registros, { fpsAlvo = 5 } = {}) {
  const porSubsistema = {};
  let janelaTotalMs = 0;
  let framesTotais = 0;
  let ciclosComAmostragem = 0;

  for (const registro of registros) {
    const amostragem = registro?.metricas?.amostragem;
    if (!amostragem) continue;
    ciclosComAmostragem += 1;
    const janelaMs = Number(amostragem.janelaMs) || 0;
    janelaTotalMs += janelaMs;
    const meta = registro?.politica?.cadencia;

    for (const subsistema of SUBSISTEMAS) {
      const metrica = amostragem.porSubsistema?.[subsistema];
      if (!metrica) continue;
      const acumulado = (porSubsistema[subsistema] ??= {
        ciclos: 0,
        amostrados: 0,
        frames: 0,
        fpsEfetivo: [],
        intervaloMedioMs: [],
        intervaloAlvoMs: new Set(),
        janelaMs: 0,
      });
      acumulado.ciclos += 1;
      acumulado.amostrados += Number(metrica.amostrados) || 0;
      const intervaloAlvo = Number(metrica.intervaloAlvoMs ?? meta?.[`${subsistema}Ms`]);
      if (Number.isFinite(intervaloAlvo) && intervaloAlvo > 0) {
        acumulado.intervaloAlvoMs.add(intervaloAlvo);
      }
      if (Number.isFinite(metrica.fpsEfetivo)) acumulado.fpsEfetivo.push(metrica.fpsEfetivo);
      if (Number.isFinite(metrica.intervaloMedioMs)) {
        acumulado.intervaloMedioMs.push(metrica.intervaloMedioMs);
      }
      acumulado.janelaMs += janelaMs;
      // Frames por ciclo = observacoes do registro (o plano tem um item por frame).
      acumulado.frames += Number(registro.observacoes) || 0;
    }
    framesTotais += Number(registro.observacoes) || 0;
  }

  const resumo = {};
  for (const subsistema of SUBSISTEMAS) {
    const acumulado = porSubsistema[subsistema];
    if (!acumulado) {
      resumo[subsistema] = {
        ciclos: 0,
        amostrados: 0,
        frames: 0,
        cobertura: null,
        fpsAlvo: null,
        fpsEfetivo: null,
        fpsEfetivoMaximo: null,
        intervaloAlvoMs: null,
        intervaloMedioMs: null,
        atingiu: null,
      };
      continue;
    }
    const intervalos = [...acumulado.intervaloAlvoMs];
    const intervaloAlvoMs = intervalos.length === 1 ? intervalos[0] : intervalos.length ? Math.min(...intervalos) : null;
    const fpsAlvoSubsistema =
      intervaloAlvoMs !== null ? arredondar(1000 / intervaloAlvoMs, 1) : subsistema === "maos" ? fpsAlvo : null;
    const fpsEfetivo = mediana(acumulado.fpsEfetivo);
    const cobertura =
      acumulado.frames > 0 ? arredondar(acumulado.amostrados / acumulado.frames, 3) : null;
    const alvo = fpsAlvoSubsistema ?? (subsistema === "maos" ? fpsAlvo : null);
    resumo[subsistema] = {
      ciclos: acumulado.ciclos,
      amostrados: acumulado.amostrados,
      frames: acumulado.frames,
      cobertura,
      fpsAlvo: arredondar(alvo, 1),
      fpsEfetivo: arredondar(fpsEfetivo, 1),
      fpsEfetivoMaximo: arredondar(Math.max(...acumulado.fpsEfetivo), 1),
      intervaloAlvoMs,
      intervaloMedioMs: Math.round(mediana(acumulado.intervaloMedioMs) ?? NaN) || null,
      // Tolerancia de 90% do alvo: jitter de captura nao reprova um benchmark.
      atingiu: fpsEfetivo !== null && alvo !== null ? arredondar(fpsEfetivo, 1) >= arredondar(alvo * 0.9, 1) : null,
    };
  }

  return {
    ciclosComAmostragem,
    framesTotais,
    janelaTotalMs: Math.round(janelaTotalMs),
    porSubsistema: resumo,
  };
}

/** Agrega a latencia por etapa de todos os ciclos (mediana e P95). */
export function agregarLatencia(registros) {
  const etapas = ["capturaMs", "deteccaoMs", "poseMs", "maosMs", "nsfwMs", "temporalMs", "multimodalMs", "totalMs"];
  const resumo = {};
  for (const etapa of etapas) {
    const valores = registros
      .map((registro) => registro?.metricas?.[etapa])
      .filter((valor) => Number.isFinite(valor));
    resumo[etapa] = {
      amostras: valores.length,
      mediana: arredondar(mediana(valores), 0),
      p95: arredondar(percentil(valores, 0.95), 0),
    };
  }
  return resumo;
}

/**
 * Monta o resumo final. `veredito` e `true` apenas quando ha ciclos suficientes
 * e todos os subsistemas medidos com alvo atingiram; caso contrario `false`.
 */
export function resumirBenchmark(registros, opcoes = {}) {
  const { politica, fpsAlvo = 5, minCiclos = 1, warmup = 0 } = opcoes;
  const uteis = aplicarWarmup(filtrarPorPolitica(registros.filter(ehCicloUtil), politica), warmup);
  const amostragem = agregarAmostragem(uteis, { fpsAlvo });
  const latencia = agregarLatencia(uteis);
  const avaliados = Object.entries(amostragem.porSubsistema).filter(([, resumo]) => resumo.atingiu !== null);
  const veredito =
    uteis.length >= minCiclos && avaliados.length > 0 && avaliados.every(([, resumo]) => resumo.atingiu === true);
  return {
    politica: politica ?? null,
    fpsAlvo,
    ciclos: uteis.length,
    suficiente: uteis.length >= minCiclos,
    veredito,
    amostragem,
    latencia,
    geradoEm: new Date().toISOString(),
  };
}
