export interface Caixa {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}

export interface ObjetoVisto {
  nome: string;
  rotulo: string;
  score: number;
  caixa: Caixa;
}

export type TipoEntrada = "deteccao" | "descricao" | "roteiro";

/** Razao que acionou uma analise do modelo de visao (Fase 5). */
export type MotivoAnalise =
  | "primeira_analise"
  | "mudanca_de_cena"
  | "nova_entidade"
  | "desaparecimento"
  | "movimento"
  | "baixa_confianca"
  | "resumo_periodico"
  | "manual"
  | "falha_percepcao";

export interface EntradaLog {
  timestamp: string;
  modelo: string;
  objetos: ObjetoVisto[];
  resumo: string;
  tipo: TipoEntrada;
  papel?: "base" | "delta";
  snapshot?: string;
  /**
   * Instante ISO em que o frame foi capturado (antes da inferencia). `timestamp`
   * e o momento em que a entrada foi montada, apos a analise; comparar os dois
   * revela o atraso entre o que foi visto e o que terminou de ser interpretado.
   */
  capturadoEm?: string;
  ms?: number;
  tokens?: number;
  /** Motivo que acionou esta analise (somente descricao/roteiro). */
  motivo?: MotivoAnalise;
  /** Sessao a que pertence esta entrada (legado: ausente). */
  sessaoId?: string;
  /** Identificador do frame que gerou esta entrada (reutilizado para deduplicar snapshots). */
  frameId?: string;
}

/** Objeto acompanhado ao longo de varios frames dentro de uma sessao. */
export interface ObjetoRastreado {
  /** Identificador estavel da sessao (ex.: `obj-<sessao>-1` ou `obj-1` para legado). */
  id: string;
  /** Rotulo original do detector (ex.: `person`). */
  rotulo: string;
  /** Rotulo traduzido para exibicao (ex.: `pessoa`). */
  nome: string;
  /** Confianca da ultima observacao. */
  score: number;
  /** Ultima caixa delimitadora observada. */
  caixa: Caixa;
  /** Momento (ms) em que o objeto foi visto pela primeira vez. */
  primeiraObservacao: number;
  /** Momento (ms) da ultima vez em que o objeto foi visto. */
  ultimaObservacao: number;
  /** Quantidade de frames em que o objeto foi associado. */
  framesVisto: number;
  /** Frames consecutivos em que o objeto deixou de ser detectado. */
  framesAusente: number;
}

/** Deteccoes de um unico frame, base para a associacao temporal. */
export interface Observacao {
  /** Instante ISO do frame. */
  timestamp: string;
  /** Instante monotonico (ms) usado nos limiares temporais. */
  tempoMs: number;
  /** Objetos detectados no frame. */
  objetos: ObjetoVisto[];
}

/** Tipos de evento visual derivados do rastreamento. */
export type TipoEventoVisual =
  | "aparicao"
  | "desaparecimento"
  | "movimento"
  | "mudanca_de_cena"
  | "resumo";

/** Subsistema que originou o evento. */
export type OrigemEvento = "detector" | "rastreador" | "ollama";

/** Acontecimento estruturado, distinto de uma deteccao crua. */
export interface EventoVisual {
  id: string;
  timestamp: string;
  tipo: TipoEventoVisual;
  /** Objeto rastreado relacionado, quando aplicavel. */
  objetoId?: string;
  descricao: string;
  confianca?: number;
  origem: OrigemEvento;
  snapshot?: string;
  modelo?: string;
  /** Sessao a que pertence este evento (legado: ausente). */
  sessaoId?: string;
  /** Chave de idempotencia para evitar duplicacao de eventos no servidor. */
  idempotencyKey?: string;
  /** Identificador do frame que gerou este evento (reutilizado para deduplicar snapshots). */
  frameId?: string;
}
