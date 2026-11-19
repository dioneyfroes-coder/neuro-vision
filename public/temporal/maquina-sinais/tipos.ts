import type { MotivoEncerramentoEvento } from "../../../src/domain";

export interface LeituraSinal {
  entidadeId: string;
  rotulo: string | null;
  confianca: number;
  frameId: string;
  timestamp: string;
  cycleId: string;
  /**
   * `false` quando a entidade ainda esta no rastreador (janela de tolerancia),
   * mas **nao foi vista** neste frame. A leitura continua contando ausencia de
   * sinal, porem nao avanca `ultimaObservacaoEm`: observar que o sinal sumiu e
   * diferente de observar a entidade.
   *
   * Omitido equivale a `true` (leitura de entidade efetivamente observada).
   */
  observada?: boolean;
  /**
   * `false` quando o intervalo desde a leitura anterior nao e confiavel
   * (intervalo invalido ou longo demais). O sinal pode continuar, mas o evento
   * resultante nao afirma continuidade temporal.
   */
  continuidadeValida?: boolean;
  /** Evidencias textuais que sustentam o sinal (ex.: `geometria:todos`). */
  evidencias?: string[];
}

/**
 * Por que um evento foi encerrado (preservado no diagnostico).
 *
 * `oclusao` e distinto de `sem_sinal`: a entidade deixou de ser vista, em vez
 * de ter sido observada sem o sinal. `periodo_cego` indica uma lacuna entre
 * ciclos, nao uma ausencia observada.
 */
export type MotivoEncerramento = Extract<
  MotivoEncerramentoEvento,
  "sem_sinal" | "troca_sinal" | "periodo_cego" | "oclusao"
>;

/**
 * Evento de sinal emitido pela maquina, com identidade estavel por todo o
 * ciclo de vida (confirmacao e encerramento compartilham o mesmo `eventoId`).
 *
 * `fimEm` e sempre o instante da **ultima evidencia positiva** — nunca o frame
 * em que a ausencia foi percebida nem o inicio do evento. Assim a duracao
 * reflete o que foi de fato observado e nunca fica negativa.
 */
export interface EventoSinal {
  eventoId: string;
  entidadeId: string;
  rotulo: string;
  estado: "confirmado" | "encerrado";
  inicioEm: string;
  fimEm?: string;
  /** Instante ISO da ultima evidencia positiva do sinal. */
  ultimaEvidenciaEm: string;
  /** Instante ISO da ultima observacao valida da entidade (com ou sem sinal). */
  ultimaObservacaoEm: string;
  frameIds: string[];
  confianca: number;
  cycleIdInicio: string;
  /** Frames em que o sinal foi observado (evidencia). */
  framesSinal: number;
  motivoEncerramento?: MotivoEncerramento;
  /** Duracao (ms) do periodo cego que interrompeu o evento, quando houver. */
  intervaloSemObservacaoMs?: number;
  /** `false` se algum intervalo da evidencia nao pode ser validado. */
  continuidadeValida: boolean;
  /** Evidencias textuais acumuladas (modelo, geometria, velocidade). */
  evidencias: string[];
}

export interface Ativo {
  eventoId: string;
  entidadeId: string;
  rotulo: string;
  inicioEm: string;
  cycleIdInicio: string;
  frameIds: string[];
  confianca: number;
  framesSinal: number;
  /** Instante ISO da ultima leitura valida que sustentou o sinal. */
  ultimoSinalEm: string;
  /** Instante ISO da ultima observacao valida da entidade (com ou sem sinal). */
  ultimaObservacaoEm: string;
  /** Ultimo frame com evidencia positiva do sinal. */
  ultimoFrameId: string;
  continuidadeValida: boolean;
  evidencias: string[];
}

export interface EstadoEntidade {
  entidadeId: string;
  rotuloCandidato: string | null;
  framesCandidato: number;
  frameIdsCandidato: string[];
  inicioCandidato: string | null;
  cycleIdCandidato: string | null;
  confiancaCandidato: number;
  evidenciasCandidato: string[];
  framesSemSinal: number;
  motivoUltimaAusencia: MotivoEncerramento;
  ativo: Ativo | null;
}

/** Fotografia do estado corrente de um sinal, para diagnostico. */
export interface DiagnosticoMaquinaSinal {
  entidadeId: string;
  ativo: boolean;
  rotuloAtivo?: string;
  rotuloCandidato?: string;
  framesCandidato: number;
  /** Frames de evidencia positiva (ativo) ou do candidato corrente. */
  framesEvidencia: number;
  framesSemSinal: number;
  motivoUltimaAusencia: MotivoEncerramento;
  confianca: number;
  continuidadeValida: boolean;
  evidencias: string[];
  ultimaEvidenciaEm?: string;
  ultimaObservacaoEm?: string;
}

/** Opcoes de `processar` para distinguir "sem sinal" de "nao foi possivel ver". */
export interface OpcoesProcessarSinais {
  /**
   * `true` quando o subsistema de origem estava **indisponivel** neste frame
   * (falha, timeout, modelo nao carregado). A maquina preserva os eventos
   * ativos, nao conta ausencia e reinicia candidatos: uma inferencia que falhou
   * nao pode encerrar gesto nem confirmar sinal.
   */
  indisponivel?: boolean;
}
