import type { StatusEvidencia } from "../evidencia";

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

/** Qualidade da associação entre uma observação e uma entidade da referência. */
export type AssociacaoInstanciaCena = "estavel" | "ambiga";

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
  /** Identidade da instância, quando o rótulo não é suficiente (duas cadeiras). */
  instanciaId?: string;
  /** Classe detectada, quando diferente do rótulo legível. */
  classe?: string;
  primeiraObservacaoEmMs?: number;
  ultimaObservacaoEmMs?: number;
  frameIds?: string[];
  confiancaAssociacao?: number;
  associacao?: AssociacaoInstanciaCena;
  /** Status canônico derivado de `confirmacao` (aditivo, não substitui o legado). */
  statusEvidencia?: StatusEvidencia;
}

/**
 * Modo de consolidação da referência.
 *
 * - `automatica` (padrão): usa `instanciaId` quando presente e mantém o
 *   comportamento legado (um item por rótulo) para lotes sem identidade;
 * - `instancia`: agrupa por `instanciaId`/`objetoId`, preservando classes
 *   repetidas;
 * - `rotulo`: força o comportamento legado, útil para dados antigos.
 */
export type ConsolidacaoReferenciaCena = "automatica" | "instancia" | "rotulo";

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
  /** Quando a associação à instância da referência não é segura. */
  associacao?: AssociacaoInstanciaCena;
  statusEvidencia?: StatusEvidencia;
}

export interface OpcoesComparacaoCena {
  /** Sobreposição mínima para considerar "mesmo lugar" (padrão: 0,25). */
  iouMinimo?: number;
  /** Distância máxima entre centros, em coordenadas normalizadas (padrão: 0,25). */
  distanciaMaxima?: number;
  /** Usa `instanciaId` como parte da chave de associação (padrão: `true`). */
  associacaoPorInstancia?: boolean;
}
