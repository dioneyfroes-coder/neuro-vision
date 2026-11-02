import type { ObservacaoFrame } from "./observation";
import type { ResultadoIndisponivel, TelemetriaSubsistema } from "./perception";
import { estaIndisponivel } from "./perception";
import type { EventoTemporal } from "./temporal-event";

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
}

/** Leitura consolidada do motor temporal para um ciclo. */
export interface ResumoTemporal {
  /** Eventos ativos/encerrados neste ciclo (com identidade unica). */
  eventos: EventoTemporal[];
  /**
   * Tracks vivos no fim do ciclo: **soma** de pessoas, maos e objetos
   * rastreados. Nao e a quantidade de entidades fisicas distintas — uma mesma
   * pessoa pode contribuir com o track de pose e com um ou dois tracks de mao.
   * Use a decomposicao abaixo quando o numero precisar de significado fisico.
   */
  tracksAtivos: number;
  /** Tracks de pessoas (pose) vivos no fim do ciclo. */
  pessoasAtivas: number;
  /** Tracks de maos vivos no fim do ciclo. */
  maosAtivas: number;
  /** Tracks de objetos vivos no fim do ciclo. */
  objetosAtivos: number;
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

/** Alias do subsistema de percepcao usado nas metricas por ciclo. */
export type SubsistemaMetricaCiclo = ResultadoIndisponivel["subsistema"];

/**
 * Carga fria dos modelos de percepcao, observada uma vez por sessao.
 *
 * Fica em cada registro de ciclo para que o custo de inicializacao nao se
 * confunda com a inferencia aquecida: `tempoCargaMs` e o custo de carregar o
 * modelo, enquanto `MetricasCiclo.inferenciaPorSnapshotMs` mede o regime
 * aquecido. `subsistemas` so inclui quem tentou carregar (carregado ou falhou).
 */
export interface CargaModelosCiclo {
  /** Tempo total de carregamento da sessao (ms), quando medido pelo controlador. */
  totalMs?: number;
  /** Telemetria de carga por subsistema (modelo, dispositivo, versao e custo). */
  subsistemas: Partial<Record<SubsistemaMetricaCiclo, TelemetriaSubsistema>>;
}

/** Contagens agregadas da saida real dos modelos locais durante o ciclo. */
export interface EvidenciaPercepcaoCiclo {
  deteccao: {
    quadrosValidos: number;
    deteccoes: number;
  };
  pose: {
    quadrosValidos: number;
    pessoas: number;
    keypoints: number;
    pessoasCom17Keypoints: number;
  };
  maos: {
    quadrosValidos: number;
    maos: number;
    landmarks: number;
    maosCom21Landmarks: number;
  };
}

export interface LimitesContextoCiclo {
  maxImagens: number;
  maxEventos: number;
  maxPontosPorFrame: number;
  decimais: number;
  maxBytesContexto: number;
}

export interface OpcoesSerializacaoContextoCiclo {
  decimais: number;
  landmarksCompletos: boolean;
  geometriaMao: boolean;
  confiancaMinimaKeypoint: number;
  maxKeypointsPorPessoa: number;
  confiancaMinimaDeteccao: number;
  maxDeteccoesPorFrame: number;
  maxPessoasPorFrame: number;
  maxMaosPorFrame: number;
}

/** Configuracao efetiva do interpretador para tornar o ciclo reproduzivel. */
export interface ConfiguracaoInterpretadorCiclo {
  modeloSolicitado?: string;
  incluirDadosLocais: boolean;
  limites: LimitesContextoCiclo;
  serializacao: OpcoesSerializacaoContextoCiclo;
}

/**
 * Configuracao do pipeline efetivamente usada. `politica` segue separada pois
 * tambem registra a frequencia de interpretacao e a pausa pos-ciclo.
 */
export interface ConfiguracaoCiclo {
  varianteId: string;
  quantidadeSnapshotsConfigurada: number;
  intervaloEntreSnapshotsMs: number;
  /** Intervalo do agendador entre ciclos, conforme configurado na interface. */
  intervaloAgendamentoMs?: number;
  modeloMultimodalEfetivo?: string;
  interpretador?: ConfiguracaoInterpretadorCiclo;
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
  /**
   * Custo wall-clock do processamento do conjunto completo de snapshots (fim da
   * captura -> fim da percepcao), nao a soma das inferencias isoladas. Responde
   * "quanto custou processar as 4 imagens antes do multimodal", sem contar a
   * espera proposital entre capturas.
   */
  percepcaoTotalMs?: number;
  /**
   * Custo aquecido medio por snapshot, por subsistema (ms). Derivado das
   * inferencias efetivamente executadas no ciclo; subsistema sem inferencia
   * valida fica ausente em vez de virar zero.
   */
  inferenciaPorSnapshotMs?: Partial<Record<SubsistemaMetricaCiclo, number>>;
  /** Saida agregada dos modelos locais; falhas e subsistemas nao executados nao contam. */
  resultadosPercepcao?: EvidenciaPercepcaoCiclo;
  /**
   * Inicio do ciclo ate a conclusao da resposta multimodal (ms). Ausente quando
   * a interpretacao foi suprimida pela politica ou falhou.
   */
  latenciaAteRespostaMultimodalMs?: number;
  /**
   * Intervalo entre o fim do ciclo anterior e o inicio deste (ms). Inclui a
   * pausa/agendamento; ausente no primeiro ciclo da sessao.
   */
  latenciaEntreCiclosMs?: number;
  /**
   * Maior heap observado durante o ciclo (bytes), quando o runtime expoe
   * `performance.memory`. E uma amostra do processo, nao memoria exclusiva de
   * um modelo.
   */
  memoriaMaximaBytes?: number;
  /** Carga fria dos modelos da sessao (mesma em todos os ciclos). */
  cargaModelos?: CargaModelosCiclo;
  /**
   * Timestamps ISO de **conclusao** de cada etapa (Fase 4, item 4). Permitem
   * reconstruir a linha do tempo real do ciclo, nao apenas a duracao agregada.
   */
  capturaConcluidaEm?: string;
  percepcaoConcluidaEm?: string;
  temporalConcluidoEm?: string;
  interpretacaoConcluidaEm?: string;
  persistenciaConcluidaEm?: string;
  /** Instante ISO da conclusao efetiva do ciclo (depois de persistir). */
  concluidoEm?: string;
  /** Motivo pelo qual a interpretacao multimodal foi suprimida pela politica. */
  interpretacaoSuprimida?: MotivoSupressaoInterpretacao;
  /**
   * Janela real de captura do ciclo (ms): diferenca entre o primeiro e o ultimo
   * snapshot efetivamente observado. Pode ser menor que a janela nominal quando
   * a captura perde frames; e `0` com um unico frame.
   */
  janelaCapturaMs?: number;
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
    politica: pacote.politica,
    configuracao: pacote.configuracao,
    cancelado: resultado.cancelado,
    registroEm: opcoes.registroEm ?? new Date().toISOString(),
  };
}
