export interface RegiaoCena {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}

export type ConfirmacaoCena =
  | "confirmado"
  | "possivel"
  | "ocluido"
  | "nao_confirmado"
  | "nao_observado";

/** Item observado do ambiente. `objetoId` é temporário e escopo de sessão. */
export interface ItemCena {
  objetoId: string;
  rotulo: string;
  caixa: RegiaoCena;
  confirmacao: ConfirmacaoCena;
  confianca: number;
  /** Estado físico observável (ex.: "aberto", "no chão"); não é confirmação. */
  estadoObjeto?: string;
  frameId?: string;
  observadoEmMs?: number;
}

/** Referência consolidada do ambiente no início de uma sessão. */
export interface ReferenciaCena {
  sessaoId: string;
  criadaEmMs: number;
  /** Quantidade de quadros usados para consolidar o inventário. */
  quadros: number;
  itens: ItemCena[];
}

export type TipoMudancaCena =
  | "objeto_adicionado"
  | "objeto_removido"
  | "objeto_movido"
  | "estado_alterado"
  | "possivel_mudanca";

/**
 * Mudança detectada entre referência e observação atual.
 *
 * `observado: false` marca inferência (ausência ou detecção fraca) — nunca deve
 * ser lido como "a mudança foi vista diretamente".
 */
export interface MudancaCena {
  /** Estável para a mesma mudança, mesmo se comparada em vários quadros. */
  mudancaId: string;
  sessaoId: string;
  tipo: TipoMudancaCena;
  objetoId: string;
  rotulo: string;
  confianca: number;
  observado: boolean;
  detectadoEmMs: number;
  referenciaEmMs: number;
  deslocamento?: number;
  caixaAnterior?: RegiaoCena;
  caixaAtual?: RegiaoCena;
  estadoAnterior?: string;
  estadoAtual?: string;
}

export interface OpcoesComparacaoCena {
  /** Sobreposição mínima para considerar "mesmo lugar" (padrão: 0,25). */
  iouMinimo?: number;
  /** Distância máxima entre centros, em coordenadas normalizadas (padrão: 0,25). */
  distanciaMaxima?: number;
}
