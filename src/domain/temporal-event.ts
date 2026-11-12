/**
 * Eventos de dominio e suas evidencias (roteiro 4.4).
 *
 * Diferente de `EventoVisual` (legado, um por frame), um `EventoTemporal` tem
 * identidade unica: um evento continuo e **atualizado** ate encerrar, em vez de
 * ser duplicado em todos os frames.
 */

/** Tipo normalizado de evento temporal. */
export type TipoEventoTemporal =
  | "gesto_detectado"
  | "braco_levantado"
  | "transicao_acao"
  | "movimento_corporal"
  | "pose_compativel_sexual"
  | "movimento_objeto"
  | "aparicao"
  | "desaparecimento"
  | "mudanca_de_cena";

/** Ciclo de vida de um evento. */
export type EstadoEventoTemporal = "candidato" | "confirmado" | "encerrado" | "incerto";

/** Origem dos sinais que sustentam o evento (qual subsistema contribuiu). */
export type OrigemSinalTemporal = "objetos" | "pose" | "maos" | "cena" | "movimento";

/**
 * Motivo explicito de encerramento de um evento temporal.
 *
 * - `sem_sinal`: a entidade foi observada, mas o sinal deixou de existir;
 * - `troca_sinal`: outro sinal substituiu o anterior no mesmo track;
 * - `periodo_cego`: lacuna entre ciclos interrompeu a observacao;
 * - `oclusao`: a entidade deixou de ser vista (nao foi inferencia que falhou);
 * - `transicao_concluida`/`ponto`: evento pontual, sem duracao sustentada.
 */
export type MotivoEncerramentoEvento =
  | "sem_sinal"
  | "troca_sinal"
  | "periodo_cego"
  | "oclusao"
  | "transicao_concluida"
  | "ponto";

/**
 * Diagnostico corrente de um sinal temporal.
 *
 * Diferencia o que virou evento do que apenas foi visto: um gesto confirmado,
 * um evento encerrado, uma mao ocluida, uma inferencia indisponivel e uma
 * observacao insuficiente para confirmar nao sao a mesma coisa.
 */
export type EstadoDiagnosticoSinal =
  | "confirmado"
  | "encerrado"
  | "ocluido"
  | "inferencia_indisponivel"
  | "observacao_insuficiente";

/** Subsistema logico que produziu o diagnostico. */
export type SinalTemporalDiagnosticado =
  | "gesto"
  | "braco"
  | "movimento"
  | "transicao"
  | "pose_sexual";

export interface DiagnosticoSinalTemporal {
  sinal: SinalTemporalDiagnosticado;
  entidadeId: string;
  estado: EstadoDiagnosticoSinal;
  rotulo?: string;
  confianca: number;
  /** Frames em que o sinal positivo foi observado. */
  framesEvidencia: number;
  /** Frames consecutivos sem o sinal (para o estado corrente). */
  framesSemSinal: number;
  /** Evidencias textuais que sustentam (ou sustentaram) o sinal. */
  evidencias: string[];
  continuidadeValida: boolean;
  motivoEncerramento?: MotivoEncerramentoEvento;
  ultimaEvidenciaEm?: string;
  ultimaObservacaoEm?: string;
}

export interface EventoTemporal {
  /** ID globalmente unico, para persistencia e referencias. */
  eventoId: string;
  sessionId: string;
  /** Ciclo em que o evento comecou (pode se estender a ciclos futuros). */
  cycleId?: string;
  tipo: TipoEventoTemporal;
  /** Instante ISO do inicio do evento. */
  inicioEm: string;
  /**
   * Instante ISO do fim do evento, quando encerrado. Para sinais, coincide com
   * a **ultima evidencia positiva** (`ultimaEvidenciaEm`), nunca com o frame em
   * que a ausencia foi percebida.
   */
  fimEm?: string;
  /**
   * Instante ISO da ultima evidencia **positiva** do evento (o sinal ainda
   * estava presente). Pode ser anterior a `ultimaObservacaoEm` quando o sinal
   * sumiu, mas a entidade/subsistema continuou sendo observado.
   */
  ultimaEvidenciaEm?: string;
  /**
   * Instante ISO da ultima **observacao valida** da entidade/subsistema, mesmo
   * sem sinal positivo. Ajuda a separar "o sinal parou" (evidencia) de "a
   * observacao parou" (lacuna/entidade fora de quadro).
   */
  ultimaObservacaoEm?: string;
  /** Entidade associada (objeto, pessoa ou mao rastreada), quando houver. */
  entidadeId?: string;
  /** Rotulo do detector da entidade associada, quando for um objeto rastreado. */
  rotuloObjeto?: string;
  /** Descricao legivel em portugues. */
  descricao: string;
  /** Confianca em [0,1] agregada dos sinais. */
  confianca?: number;
  /** Sinais que originaram o evento. */
  origens: OrigemSinalTemporal[];
  /** Frames de evidencia, em ordem cronologica. */
  frameIds: string[];
  estado: EstadoEventoTemporal;
  /**
   * Duracao (ms) do periodo cego que interrompeu o evento, quando houver. Um
   * evento com este campo foi encerrado **nao** por ausencia observada, mas por
   * uma lacuna de observacao: o fim coincide com a ultima evidencia positiva e
   * o estado fica `incerto` (nunca `encerrado`).
   */
  intervaloSemObservacaoMs?: number;
  /** Por que o evento terminou (ausencia, troca, oclusao ou lacuna). */
  motivoEncerramento?: MotivoEncerramentoEvento;
  /**
   * `false` quando a continuidade temporal nao pode ser validada (intervalo
   * invalido, longo demais ou periodo cego). O evento continua registrado, mas
   * sem afirmar continuidade.
   */
  continuidadeValida?: boolean;
  /**
   * Evidencias textuais que sustentaram o evento (ex.: `geometria:todos`,
   * `mediapipe:mao_aberta`, `velocidadeY:-0.5/s`). Preserva a origem concreta
   * sem transformar heuristica em certeza.
   */
  evidencias?: string[];
}
