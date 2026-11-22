import type { DiagnosticoSelecaoFrames } from "../../../src/domain/selecao-frames";
import type {
  ContextoCicloSerializavel,
  ObservacaoLocalSerializavel,
  OpcoesSerializacao,
} from "../esquema";
import type { ConfigProximidadeObjetos } from "../proximidade-objetos";

export interface LimitesContexto {
  /** Maximo de imagens/frames enviados (os mais recentes). */
  maxImagens: number;
  /** Maximo de eventos temporais incluidos. */
  maxEventos: number;
  /** Maximo de pontos corporais relevantes por frame (legado; ver `opcoes`). */
  maxPontosPorFrame: number;
  /** Casas decimais para coordenadas/confiancas (limita dados numericos). */
  decimais: number;
  /** Teto do JSON do contexto em **bytes UTF-8** (nao unidades de string). */
  maxBytesContexto: number;
}

export const LIMITES_CONTEXTO_PADRAO: LimitesContexto = {
  maxImagens: 4,
  maxEventos: 20,
  maxPontosPorFrame: 6,
  decimais: 2,
  maxBytesContexto: 16_000,
};

export interface PayloadContexto {
  /** Imagens (data URL) na ordem dos frames do contexto. */
  imagens: string[];
  contexto: ContextoCicloSerializavel;
  /** Regra de seleção aplicada (Fase 6, item 2); ausente no caminho legado. */
  selecao?: DiagnosticoSelecaoFrames;
}

/** Opcoes de montagem do contexto (Etapa 9). */
export interface OpcoesContexto {
  /**
   * Inclui no contexto os dados derivados da percepcao local (deteccoes, pose,
   * maos, movimento e eventos temporais). Na variante B (`false`) vao ao
   * multimodal apenas as imagens e a cronologia (`frameId`, `indice`,
   * `capturadoEm`, `offsetMs`), para isolar o valor do contexto entre imagens.
   */
  incluirDadosLocais?: boolean;
  /**
   * Serializacao do schema (decimais, keypoints, limites por frame). Default:
   * `OPCOES_SERIALIZACAO_PADRAO`, com `decimais` herdado de `LimitesContexto`.
   */
  serializacao?: Partial<OpcoesSerializacao>;
  /**
   * Raios de atencao para ordenar objetos por proximidade a maos/corpo (Fase 4).
   * Nao altera certeza: apenas a ordem em que a evidencia e apresentada.
   */
  proximidadeObjetos?: Partial<ConfigProximidadeObjetos>;
  /**
   * Critério de escolha dos frames enviados (Fase 6, item 2). `uniforme`
   * preserva o comportamento legado; `relevancia` prioriza frames com eventos
   * sustentados/atividade, mantendo primeiro e último e registrando o motivo.
   */
  selecaoFrames?: "uniforme" | "relevancia";
}

/** Resultado interno da montagem de um frame, com o mapa de posicoes. */
export interface FrameMontado {
  observacao: ObservacaoLocalSerializavel;
  posicoes: Map<string, { x: number; y: number; tMs: number }>;
}
