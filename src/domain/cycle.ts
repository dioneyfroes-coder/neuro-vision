import type { ObservacaoFrame } from "./observation";
import type { ResultadoIndisponivel } from "./perception";
import { estaIndisponivel } from "./perception";
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
  /**
   * Duracao (ms) do periodo cego anterior a este ciclo, quando detectado.
   * Explicita a lacuna: eventos em curso foram interrompidos no ultimo instante
   * de evidencia, sem presuncao de continuidade.
   */
  intervaloSemObservacaoMs?: number;
}

/** Metricas por etapa de um ciclo (roteiro 5.7/7). */
export interface MetricasCiclo {
  capturaMs?: number;
  deteccaoMs?: number;
  poseMs?: number;
  maosMs?: number;
  /** Classificador NSFW (experimental; presente apenas quando habilitado). */
  nsfwMs?: number;
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

/**
 * Registro persistido de um ciclo (roteiro 5.7 e Etapa 8).
 *
 * Reune o que e preciso para **diagnosticar** um ciclo (metricas por etapa,
 * erros parciais, subsistemas indisponiveis) e para **rastrear as relacoes**
 * entre sessao, imagens e eventos (`sessionId`, `cycleId`, `frameIds`). Nao
 * incorpora as imagens: elas vivem nos snapshots, referenciados pelos frameIds.
 */
export interface RegistroCiclo {
  sessionId: string;
  cycleId: string;
  iniciadoEm: string;
  concluidoEm?: string;
  /** Frames do ciclo, em ordem de captura — a relacao entre ciclo e imagens. */
  frameIds: string[];
  /** Quantidade de frames efetivamente observados. */
  observacoes: number;
  /** Quantidade de eventos temporais emitidos no ciclo. */
  eventosTemporais: number;
  /** Subsistemas que estavam indisponiveis em pelo menos um frame. */
  subsistemasIndisponiveis: Array<ResultadoIndisponivel["subsistema"]>;
  /** Erros por etapa: um ciclo parcial continua diagnosticavel. */
  erros: ErroEtapa[];
  metricas: MetricasCiclo;
  /** Interpretacao multimodal, quando houve. */
  interpretacao?: string;
  cancelado: boolean;
  /** Instante ISO em que o registro foi gravado. */
  registroEm: string;
}

/** Deriva o registro persistido a partir do resultado do ciclo (funcao pura). */
export function criarRegistroCiclo(
  resultado: ResultadoCiclo,
  opcoes: { registroEm?: string } = {}
): RegistroCiclo {
  const { pacote } = resultado;
  const indisponiveis = new Set<ResultadoIndisponivel["subsistema"]>();
  for (const observacao of pacote.observacoes) {
    for (const subsistema of [observacao.deteccoes, observacao.pose, observacao.maos, observacao.nsfw]) {
      if (estaIndisponivel(subsistema)) indisponiveis.add(subsistema.subsistema);
    }
  }
  return {
    sessionId: pacote.sessionId,
    cycleId: pacote.cycleId,
    iniciadoEm: pacote.iniciadoEm,
    concluidoEm: pacote.concluidoEm,
    frameIds: pacote.observacoes.map((observacao) => observacao.frameId),
    observacoes: pacote.observacoes.length,
    eventosTemporais: pacote.eventosTemporais.length,
    subsistemasIndisponiveis: [...indisponiveis],
    erros: resultado.erros,
    metricas: pacote.metricas,
    interpretacao: resultado.interpretacao,
    cancelado: resultado.cancelado,
    registroEm: opcoes.registroEm ?? new Date().toISOString(),
  };
}
