import type { ObservacaoFrame } from "./observation";
import type { EventoTemporal } from "./temporal-event";

/** Leitura consolidada do motor temporal para um ciclo. */
export interface ResumoTemporal {
  /** Eventos ativos/encerrados neste ciclo (com identidade unica). */
  eventos: EventoTemporal[];
  /** Entidades vivas no fim do ciclo (objetos/pessoas/maos rastreados). */
  entidadesAtivas: number;
  /** Texto curto consolidado, quando o motor produz um. */
  descricao?: string;
  /** Sinal de que faltaram observacoes (janela cega anterior ao ciclo). */
  houveIntervaloSemObservacao?: boolean;
}

/** Metricas por etapa de um ciclo (roteiro 5.7/7). */
export interface MetricasCiclo {
  capturaMs?: number;
  deteccaoMs?: number;
  poseMs?: number;
  maosMs?: number;
  temporalMs?: number;
  multimodalMs?: number;
  persistenciaMs?: number;
  totalMs?: number;
}

/**
 * Pacote do ciclo (roteiro 4.3): fronteira entre analise local e
 * interpretacao multimodal. Contem as imagens originais, os resultados que
 * pertencem a cada uma e a leitura temporal consolidada.
 */
export interface PacoteCiclo {
  sessionId: string;
  cycleId: string;
  iniciadoEm: string;
  concluidoEm?: string;
  observacoes: ObservacaoFrame[];
  eventosTemporais: EventoTemporal[];
  resumoTemporal: ResumoTemporal;
  metricas: MetricasCiclo;
}

/** Erro de uma etapa do ciclo, preservado mesmo quando outras etapas funcionam. */
export interface ErroEtapa {
  etapa: "captura" | "deteccao" | "pose" | "maos" | "temporal" | "multimodal" | "persistencia";
  mensagem: string;
}

/** Resultado observavel de um ciclo completo (ou parcial). */
export interface ResultadoCiclo {
  pacote: PacoteCiclo;
  /** Interpretacao multimodal, quando a etapa rodou e deu certo. */
  interpretacao?: string;
  erros: ErroEtapa[];
  cancelado: boolean;
}
