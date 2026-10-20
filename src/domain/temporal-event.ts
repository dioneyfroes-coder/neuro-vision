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
  /** Instante ISO do fim, quando encerrado. */
  fimEm?: string;
  /** Entidade associada (objeto, pessoa ou mao rastreada), quando houver. */
  entidadeId?: string;
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
