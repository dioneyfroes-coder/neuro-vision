import {
  cadenciaParaModo,
  decidirAtivacaoMultimodal,
  eventosRelevantesParaMultimodal,
  TIPOS_EVENTO_RELEVANTES_MULTIMODAL,
  type CadenciaPercepcao,
  type ConfigFrequenciaAdaptativa,
  type ModoFrequencia,
  type ResumoTemporal,
} from "../../src/domain";
import type {
  FrequenciaInterpretacao,
  FinalidadePoliticaCiclo,
  MotivoSupressaoInterpretacao,
  PoliticaCicloAplicada,
} from "../../src/domain/cycle";

export type { FrequenciaInterpretacao, MotivoSupressaoInterpretacao } from "../../src/domain/cycle";
/**
 * Lista canônica de tipos relevantes, mantida em `politica-multimodal.ts`.
 * `provavel` conta; `candidato`/`incerto` não contam.
 */
export { TIPOS_EVENTO_RELEVANTES_MULTIMODAL as TIPOS_EVENTO_RELEVANTES };

/**
 * Politica do ciclo multiframe (Fase 4).
 *
 * Separa explicitamente os tempos que antes viviam misturados num unico
 * "intervalo":
 * - `intervaloEntreSnapshotsMs`: espacamento entre os snapshots **dentro** de um ciclo;
 * - `quantidadeSnapshots`: quantos snapshots compoem a janela do ciclo;
 * - `pausaAposCicloMs`: descanso apos a **conclusao efetiva** do ciclo (contado
 *   do fim, nao e intervalo entre inicios);
 * - `interpretacao`: quando a etapa multimodal e chamada.
 */
export interface PoliticaCiclo {
  /** Identificador estavel da politica (ex.: `benchmark-500ms`). */
  id: string;
  finalidade: FinalidadePoliticaCiclo;
  /** Rotulo legivel (ex.: `500ms`, `1s`). */
  referencia: string;
  /** Intervalo entre snapshots dentro do ciclo (ms). */
  intervaloEntreSnapshotsMs: number;
  /** Quantidade de snapshots por ciclo. */
  quantidadeSnapshots: number;
  /** Descanso apos a conclusao efetiva do ciclo (ms). */
  pausaAposCicloMs: number;
  /** Frequencia da interpretacao multimodal. */
  interpretacao: FrequenciaInterpretacao;
  /**
   * Cadencia independente por subsistema (Fase 1.3). Ausente = todos executam
   * em todos os snapshots. O intervalo entre snapshots continua sendo o teto:
   * um subsistema nunca e amostrado mais rapido que a captura.
   */
  cadencia?: CadenciaPercepcao;
  /**
   * Eleva a cadencia quando o motor confirma a entrada de uma pessoa (Fase 4).
   * O redutor e puro e determinístico por timestamps; a volta ao ritmo base tem
   * histerese por quantidade de ciclos e por tempo desde a ultima evidencia.
   * Ausente = frequencia fixa (comportamento anterior preservado).
   */
  frequenciaAdaptativa?: ConfigFrequenciaAdaptativa;
}

/** Politica padrao do modo operacional (producao/uso real). */
export const POLITICA_CICLO_OPERACIONAL: PoliticaCiclo = {
  id: "operacional-500ms",
  finalidade: "operacional",
  referencia: "500ms",
  // 500 ms entre snapshots, janela nominal ~1,5 s (0,500,1000,1500).
  intervaloEntreSnapshotsMs: 500,
  quantidadeSnapshots: 4,
  pausaAposCicloMs: 6000,
  // Sem dados locais confiaveis o suficiente ainda: manter sob demanda ou por
  // evento relevante em operacao; o benchmark define sua propria politica.
  interpretacao: "sob_demanda",
};

/** Politica de benchmark alvo (variantes multiframe): 1s entre snapshots. */
export const POLITICA_CICLO_BENCHMARK_ALVO: PoliticaCiclo = {
  id: "benchmark-1s",
  finalidade: "benchmark",
  referencia: "1s",
  // Plano original: 1 snapshot por segundo, 4 snapshots = janela ~3 s.
  intervaloEntreSnapshotsMs: 1000,
  quantidadeSnapshots: 4,
  pausaAposCicloMs: 6000,
  // Medido explicitamente como variante experimental/caro.
  interpretacao: "a_cada_ciclo",
};

/** Politica alternativa (500ms) para comparar latencia vs janela temporal. */
export const POLITICA_CICLO_BENCHMARK_RAPIDO: PoliticaCiclo = {
  id: "benchmark-500ms",
  finalidade: "benchmark",
  referencia: "500ms",
  intervaloEntreSnapshotsMs: 500,
  quantidadeSnapshots: 4,
  pausaAposCicloMs: 6000,
  interpretacao: "a_cada_ciclo",
};

/**
 * Politica de benchmark com **cadencia independente** (Fase 1.3/1.4).
 *
 * Captura 5 snapshots a 200 ms (janela de 0,8 s) e tenta amostrar as maos a
 * **5 FPS**, enquanto pose e deteccao rodam a 1 Hz. O alvo de 5 FPS e uma meta
 * de amostragem, nao uma garantia: o FPS efetivo de inferencia depende do
 * hardware e fica registrado em `metricas.amostragem` de cada ciclo. A pausa
 * pos-ciclo e zero para que o benchmark encadeie ciclos sobre movimentos curtos.
 */
export const POLITICA_CICLO_BENCHMARK_5FPS: PoliticaCiclo = {
  id: "benchmark-5fps",
  finalidade: "benchmark",
  referencia: "5fps",
  intervaloEntreSnapshotsMs: 200,
  quantidadeSnapshots: 5,
  pausaAposCicloMs: 0,
  interpretacao: "a_cada_ciclo",
  cadencia: {
    maosMs: 200,
    poseMs: 1000,
    deteccaoMs: 1000,
  },
};

/**
 * Politica de benchmark da frequencia adaptativa (Fase 4, item 3).
 *
 * Base: 5 snapshots a 200 ms com maos a 2,5 FPS e pose/deteccao a 1 Hz. Depois
 * de uma entrada confirmada, maos passam a 5 FPS e pose a 2 Hz ate a saida ser
 * confirmada e a histerese terminar. O ganho aparece em
 * `metricas.amostragem.porSubsistema.maos.fpsEfetivo` do ciclo seguinte.
 */
export const POLITICA_CICLO_BENCHMARK_ADAPTATIVA: PoliticaCiclo = {
  id: "benchmark-adaptativa",
  finalidade: "benchmark",
  referencia: "200ms-adaptativa",
  intervaloEntreSnapshotsMs: 200,
  quantidadeSnapshots: 5,
  pausaAposCicloMs: 1000,
  interpretacao: "a_cada_ciclo",
  cadencia: { maosMs: 400, poseMs: 1000, deteccaoMs: 1000 },
  frequenciaAdaptativa: {
    cadenciaAtencao: { maosMs: 200, poseMs: 500 },
    framesParaEntrar: 1,
    framesParaSair: 3,
    manterAposUltimaEvidenciaMs: 1500,
  },
};

/**
 * Politica padrao mantida para compatibilidade com codigo existente.
 * O modo operacional da interface deve passar explicitamente sua politica.
 */
export { POLITICA_CICLO_OPERACIONAL as POLITICA_CICLO_PADRAO_OPERACIONAL };

/**
 * Cria a representacao aplicada da politica para persistencia/metricas.
 * Usa a definicao completa quando disponivel, senao deriva os campos basicos.
 */
export function aplicarPolitica(
  politica: PoliticaCiclo | PoliticaCicloAplicada,
  modoFrequencia: ModoFrequencia = "base"
): PoliticaCicloAplicada {
  if ("janelaNominalMs" in politica) return politica;
  const janelaNominalMs =
    politica.quantidadeSnapshots > 0
      ? politica.intervaloEntreSnapshotsMs * Math.max(0, politica.quantidadeSnapshots - 1)
      : 0;
  const { frequenciaAdaptativa, ...base } = politica;
  const cadencia = frequenciaAdaptativa
    ? cadenciaParaModo(frequenciaAdaptativa, modoFrequencia, politica.cadencia)
    : politica.cadencia;
  return {
    ...base,
    janelaNominalMs,
    ...(cadencia ? { cadencia } : {}),
    ...(frequenciaAdaptativa
      ? { frequenciaAdaptativa: { config: frequenciaAdaptativa, estado: modoFrequencia } }
      : {}),
  };
}

/** Decisao da politica sobre a etapa multimodal, com motivo explicito. */
export interface DecisaoInterpretacao {
  /** `true` chama o modelo; `false` suprime a chamada. */
  interpretar: boolean;
  /** Motivo registrado quando a chamada e suprimida. */
  motivo?: MotivoSupressaoInterpretacao;
  /** Eventos relevantes que sustentaram a decisao (vazio quando suprimida). */
  eventosRelevantes: string[];
}

/**
 * Eventos do resumo temporal que contam como "mudanca relevante": `provavel`,
 * `confirmado` e `encerrado` (o grau `incerto` nao sustenta interpretacao).
 */
export function eventosRelevantes(resumo: ResumoTemporal): string[] {
  return eventosRelevantesParaMultimodal(resumo);
}

/**
 * Decide se o ciclo deve chamar o modelo multimodal (item 5 da Fase 4). A
 * decisao e pura e sempre devolve o motivo quando suprime, para que o registro
 * do ciclo explique a ausencia da interpretacao. `disparoManual` representa um
 * ciclo pedido pela UI (`sob_demanda`).
 */
export function decidirInterpretacao(
  politica: PoliticaCiclo | PoliticaCicloAplicada,
  resumo: ResumoTemporal,
  opcoes: { disparoManual?: boolean } = {}
): DecisaoInterpretacao {
  const decisao = decidirAtivacaoMultimodal(politica.interpretacao, resumo, {
    disparoManual: opcoes.disparoManual,
  });
  return {
    interpretar: decisao.interpretar,
    ...(decisao.motivo ? { motivo: decisao.motivo } : {}),
    eventosRelevantes: decisao.eventosRelevantes,
  };
}
