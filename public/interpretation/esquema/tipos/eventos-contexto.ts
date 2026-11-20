import type { GrupoRemovidoContexto, MotivoEncerramentoEvento } from "../../../../src/domain";
import type { DeteccoesReduzidas, ObservacaoLocalSerializavel } from "./observacao";

/** Evento temporal no schema versionado (item 5). */
export interface EventoTemporalSerializavel {
  eventoId: string;
  tipo: string;
  descricao: string;
  inicioEm: string;
  /** Ultima evidencia positiva; ausente enquanto o evento esta ativo. */
  fimEm?: string;
  /** Instante da ultima evidencia positiva (inclusive em evento ativo). */
  ultimaEvidenciaEm?: string;
  /** Instante da ultima observacao valida (pode ser posterior a evidencia). */
  ultimaObservacaoEm?: string;
  /** Ciclo de vida: `candidato`/`confirmado`/`encerrado`/`incerto`. */
  status: string;
  /** Id de entidade associada, quando houver (objeto em `interacao_objeto`). */
  trackId?: string;
  /** Pares de entidades participantes (mão↔objeto em `interacao_objeto`). */
  participantes?: string[];
  confianca?: number;
  /** Frames de evidencia, em ordem cronologica. */
  evidencias: string[];
  /** Lacuna de observacao (ms) que interrompeu o evento, quando houver. */
  gapMs?: number;
  /** Por que o evento terminou (sem sinal, troca, oclusao, periodo cego). */
  motivoEncerramento?: MotivoEncerramentoEvento;
  /** `false` quando a continuidade temporal nao pode ser validada. */
  continuidadeValida?: boolean;
  /**
   * Evidencias textuais do motor (ex.: `geometria:todos`, `velocidadeY:-0.5/s`).
   * Separadas de `evidencias` (IDs de frames) para nao misturar tipos.
   */
  evidenciasTextuais?: string[];
}

/** Grupo de evidencia podado do contexto, com contagem do que saiu. */
export type GrupoTruncamento =
  | "landmarks_mao"
  | "keypoints"
  | "movimento"
  | "evidencias_eventos"
  | "eventos_nao_confirmados"
  | "deteccoes"
  | "deteccoes_reduzidas"
  | "pessoas"
  | "maos";

/** Registro explicito de compactacao do contexto (Fase 3, item 4). */
export interface TruncamentoContexto {
  /** Sempre `true`; a presenca do campo ja indica que houve reducao. */
  ocorreu: true;
  /** Teto aplicado, em bytes UTF-8. */
  maxBytes: number;
  /** Bytes do payload completo antes de qualquer reducao. */
  bytesAntes: number;
  /** Bytes apos as reducoes, medidos antes de incluir este proprio registro. */
  bytesDepois: number;
  /** Grupos removidos/compactados e quantos itens sairam de cada um. */
  gruposRemovidos: GrupoRemovidoContexto[];
  /** `true` quando o payload continuou acima do teto apos todas as reducoes. */
  excedeuTeto: boolean;
}

/** Inferencia textual do modelo, separada da evidencia observada (item 7). */
export interface InferenciaMultimodalSerializavel {
  resumo: string;
  acoes: Array<{
    descricao: string;
    inicioEm?: string;
    fimEm?: string;
    /** Evidencias citadas pelo modelo, ja validadas contra frames/eventos. */
    evidencias: string[];
    /** Evidencias citadas que nao existem (normalizadas/removidas). */
    evidenciasInvalidas: string[];
  }>;
  incertezas: string[];
  contradicoes: string[];
}

/** Contexto do ciclo no schema versionado. */
export interface ContextoCicloSerializavel {
  versao: string;
  sessionId: string;
  cycleId: string;
  iniciadoEm: string;
  /** Duracao total observada da janela (ms). */
  janelaMs: number;
  frames: ObservacaoLocalSerializavel[];
  eventosTemporais: EventoTemporalSerializavel[];
  resumoTemporal: {
    /**
     * Soma de tracks vivos (pessoas + maos + objetos). Nao e o numero de
     * entidades fisicas: pose e maos de uma mesma pessoa contam separadamente.
     */
    tracksAtivos: number;
    /** Tracks de pessoas (pose) vivos no fim do ciclo. */
    pessoasAtivas: number;
    /** Tracks de maos vivos no fim do ciclo. */
    maosAtivas: number;
    /** Tracks de objetos vivos no fim do ciclo. */
    objetosAtivos: number;
    houveIntervaloSemObservacao: boolean;
    /** Duracao (ms) do periodo cego anterior ao ciclo, quando houver. */
    intervaloSemObservacaoMs?: number;
  };
  /** Subsistemas indisponiveis (sinalizacao de falha != ausencia). */
  indisponibilidades: string[];
  /**
   * Deteccoes observadas e compactadas por teto, agrupadas por rotulo. Evidencia
   * reduzida: o objeto foi visto, mas os detalhes nao couberam no payload.
   */
  deteccoesReduzidas?: DeteccoesReduzidas[];
  /**
   * Registro explicito de compactacao: presente quando qualquer grupo foi
   * podado, mesmo que o payload final caiba no teto. Ausente quando nada foi
   * removido. `bytesDepois` e medido antes de incluir este proprio registro.
   */
  truncamento?: TruncamentoContexto;
  /**
   * Registro explicito de que o contexto continuou acima do teto mesmo apos
   * todas as reducoes. Ausente quando o payload coube (com ou sem reducoes).
   * `bytes` e medido antes de incluir este proprio registro.
   */
  limiteContexto?: {
    maxBytes: number;
    bytes: number;
    excedeu: true;
  };
}
