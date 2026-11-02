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
  | "movimento_corporal"
  | "movimento_objeto"
  | "aparicao"
  | "desaparecimento"
  | "mudanca_de_cena";

/** Ciclo de vida de um evento. */
export type EstadoEventoTemporal = "candidato" | "confirmado" | "encerrado" | "incerto";

/** Origem dos sinais que sustentam o evento (qual subsistema contribuiu). */
export type OrigemSinalTemporal = "objetos" | "pose" | "maos" | "cena" | "movimento";

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
}
