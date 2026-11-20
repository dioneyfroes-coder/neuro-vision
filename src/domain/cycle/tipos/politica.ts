import type { CadenciaPercepcao } from "../../cadencia";
import type { ConfigFrequenciaAdaptativa, ModoFrequencia } from "../../frequencia-adaptativa";

/** Finalidade declarada da politica do ciclo. */
export type FinalidadePoliticaCiclo = "operacional" | "benchmark";

/** Quando a etapa multimodal e chamada. */
export type FrequenciaInterpretacao =
  | "a_cada_ciclo"
  | "sob_demanda"
  | "quando_evento_relevante";

/** Motivo pelo qual uma interpretacao foi suprimida (registrado no ciclo). */
export type MotivoSupressaoInterpretacao =
  | "politica_sob_demanda"
  | "sem_evento_relevante";

/**
 * Configuracao efetiva da politica do ciclo, copiada para cada registro.
 *
 * Existe para que um `ciclos.jsonl` seja reproduzivel: dois ciclos com janelas
 * temporais ou frequencias de interpretacao diferentes nao devem ser comparados
 * como se tivessem usado a mesma politica.
 */
export interface PoliticaCicloAplicada {
  /** Identificador estavel da configuracao (ex.: `benchmark-1s`). */
  id: string;
  finalidade: FinalidadePoliticaCiclo;
  /** Rotulo legivel da janela temporal (ex.: `1s`, `500ms`). */
  referencia: string;
  intervaloEntreSnapshotsMs: number;
  quantidadeSnapshots: number;
  /** Janela nominal entre o primeiro e o ultimo snapshot (ms). */
  janelaNominalMs: number;
  pausaAposCicloMs: number;
  interpretacao: FrequenciaInterpretacao;
  /**
   * Cadencia independente por subsistema (Fase 1.3), quando configurada.
   * Ausente = todos os subsistemas executam em todos os snapshots.
   */
  cadencia?: CadenciaPercepcao;
  /**
   * Frequencia adaptativa por presenca de pessoa (Fase 4), com a cadencia ja
   * efetiva do modo e o estado que a produziu — o diagnostico fica reproduzivel.
   */
  frequenciaAdaptativa?: {
    config: ConfigFrequenciaAdaptativa;
    estado: ModoFrequencia;
  };
}
