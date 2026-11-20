import type { ObservacaoFrame } from "../../observation";
import type { ResultadoIndisponivel } from "../../perception";
import type { EventoTemporal } from "../../temporal-event";
import type { ConfiguracaoCiclo, MetricasCiclo } from "./metricas";
import type { PoliticaCicloAplicada } from "./politica";
import type { ResumoTemporal } from "./resumo";

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
  /** Politica efetivamente aplicada no ciclo (ausente em chamadas legadas). */
  politica?: PoliticaCicloAplicada;
  /** Variante e configuracao efetiva do pipeline, quando fornecidas. */
  configuracao?: ConfiguracaoCiclo;
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
  /**
   * Politica efetivamente aplicada no ciclo, quando conhecida. Permite comparar
   * ciclos sem confundir janelas/frequencias diferentes.
   */
  politica?: PoliticaCicloAplicada;
  /** Variante e configuracao efetiva do pipeline, quando fornecidas. */
  configuracao?: ConfiguracaoCiclo;
  cancelado: boolean;
  /** Instante ISO em que o registro foi gravado. */
  registroEm: string;
}
