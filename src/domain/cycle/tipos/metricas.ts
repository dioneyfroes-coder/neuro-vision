import type { AmostragemCiclo } from "../../cadencia";
import type { DiagnosticoContextoMultimodal } from "../../interpretation";
import type { ResultadoIndisponivel, TelemetriaSubsistema } from "../../perception";
import type { MotivoSupressaoInterpretacao } from "./politica";

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
   * Amostragem efetiva por subsistema no ciclo (Fase 1.3/1.4): quantos frames
   * executaram cada um, intervalo medio e FPS efetivo de **amostragem**.
   * Diferente de `inferenciaPorSnapshotMs`, que mede o custo da inferencia.
   */
  amostragem?: AmostragemCiclo;
  /**
   * Compactacao do contexto multimodal enviado neste ciclo (Fase 3): bytes,
   * teto, se houve truncamento e quais grupos foram podados. A frequencia de
   * truncamento e a fracao de ciclos interpretados com `truncado: true`.
   */
  contextoMultimodal?: DiagnosticoContextoMultimodal;
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
