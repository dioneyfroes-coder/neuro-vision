/**
 * Eventos de dominio e suas evidencias (roteiro 4.4).
 *
 * Diferente de `EventoVisual` (legado, um por frame), um `EventoTemporal` tem
 * identidade unica: um evento continuo e **atualizado** ate encerrar, em vez de
 * ser duplicado em todos os frames.
 */

import type { StatusEvidencia } from "./evidencia";
import type { NaturezaInteracao, TransicaoPosse } from "./acoes-observaveis";
import type { CorrecaoEvento } from "./correcao-evento";

/** Tipo normalizado de evento temporal. */
export type TipoEventoTemporal =
  | "gesto_detectado"
  | "braco_levantado"
  | "transicao_acao"
  | "movimento_corporal"
  | "pose_compativel_sexual"
  | "interacao_objeto"
  | "movimento_objeto"
  | "aparicao"
  | "desaparecimento"
  | "mudanca_de_cena";

/**
 * Ciclo de vida de um evento.
 *
 * `provavel` e o grau intermediario de eventos de interacao: ha evidencia
 * sustentada de proximidade/sobreposicao, mas **nao** ha corroboracao suficiente
 * para afirmar contato. So vira `confirmado` com sinais adicionais explicitos.
 */
export type EstadoEventoTemporal =
  | "candidato"
  | "provavel"
  | "confirmado"
  | "encerrado"
  | "incerto";

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
  /**
   * Para eventos de interacao: as entidades participantes (mao e objeto). O
   * `entidadeId` continua apontando para a entidade principal (o objeto); este
   * campo explicita o par sem codificar identidade em texto livre.
   */
  participantes?: string[];
  /**
   * Pessoa associada à mão por pose e continuidade. É uma heurística de
   * proximidade, não identidade física; ausente quando a associação é ambígua.
   */
  pessoaEntidadeId?: string;
  /** Natureza da interação observada; ausente quando não há medição. */
  naturezaInteracao?: NaturezaInteracao;
  /** Transição de posse apoiada em evidência; ausente quando não há. */
  transicaoPosse?: TransicaoPosse;
  /**
   * Estado físico antes/depois da ação, quando o subsistema de cena observou
   * de fato um `estadoObjeto`. `estado` acima é o ciclo de vida do evento e
   * nunca deve ser usado como estado físico.
   */
  estadoAnterior?: string;
  estadoPosterior?: string;
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
  /**
   * Instante de parede (epoch ms) do frame que originou o evento. Não é o
   * instante de conclusão da inferência nem de gravação do registro.
   */
  capturadoEmMs?: number;
  /** Instante (epoch ms) em que o processamento do frame terminou. */
  processadoEmMs?: number;
  /** Instante (epoch ms) em que a inferência que sustenta o evento terminou. */
  inferidoEmMs?: number;
  /** Instante (epoch ms) em que o evento foi persistido. */
  persistidoEmMs?: number;
  /** Instante (epoch ms) em que o registro foi aceito (espelho de `registradoEm`). */
  registradoEmMs?: number;
  /** Diferença observada entre relógio do cliente e do servidor, em ms. */
  desvioRelogioMs?: number;
  /** Ordem de chegada ao servidor; nunca substitui a ordem cronológica. */
  ordemChegada?: number;
  /** Tipo de suporte da afirmação (fato, hipótese, oclusão, falha...). */
  statusEvidencia?: StatusEvidencia;
  /** Versão do schema canônico no momento da persistência (Fase 5). */
  schemaVersion?: number;
  /**
   * Correção humana auditável, quando houve. O registro original permanece no
   * stream append-only; esta versão aponta para ele por `eventoId`.
   */
  correcao?: CorrecaoEvento;
}
