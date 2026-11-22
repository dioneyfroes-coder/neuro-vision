/**
 * Sonda: ponto de referencia de uma deteccao em coordenadas normalizadas.
 *
 * Pose e maos ja sao normalizados pelos adaptadores; caixas de objeto devem ser
 * normalizadas pelo chamador quando as dimensoes forem conhecidas.
 */
export interface Sonda {
  x: number;
  y: number;
  /** Confianca agregada da deteccao, em [0,1]. */
  confianca: number;
  /** Dados arbitrarios preservados na entidade (lateralidade, rotulo, etc.). */
  meta?: Record<string, unknown>;
}

/**
 * Estado explicito do ciclo de vida do track.
 *
 * - `ativa`: observada no frame corrente;
 * - `ausente`: ainda dentro da janela de tolerancia por frames, mas nao vista;
 * - `perdida`: saiu da janela ativa; permanece reassociavel enquanto
 *   `maxTempoAusenteMs` nao expirar.
 */
export type EstadoEntidade = "ativa" | "ausente" | "perdida";

/**
 * Estado da **identidade** da entidade — distinto do ciclo de vida do track.
 * Uma entidade pode estar `ativa` e mesmo assim ter identidade `ambiga` quando
 * a reassociacao depois de uma lacuna nao pode ser provada.
 */
export type EstadoIdentidadeEntidade = "confirmada" | "provavel" | "ambiga" | "perdida";

/** Observacao leve preservada para auditoria de identidade e posicao. */
export interface ObservacaoEntidade {
  tempoMs: number;
  x: number;
  y: number;
  confianca: number;
  frameId?: string;
}

/**
 * Entidade rastreada com ID estavel dentro da sessao.
 *
 * O centro e suavizado exponencialmente; `deslocamento` e a magnitude do
 * movimento entre os dois ultimos passos (tambem suavizada).
 */
export interface Entidade {
  entidadeId: string;
  /** Estado corrente do ciclo de vida do track. */
  estado: EstadoEntidade;
  x: number;
  y: number;
  deslocamento: number;
  /** Componente vertical do movimento (negativa = subindo). */
  deslocamentoY: number;
  /** Velocidade instantanea normalizada por segundo no ultimo intervalo valido. */
  velocidade: number;
  /** Componente vertical da velocidade (negativa = subindo). */
  velocidadeY: number;
  /**
   * `false` quando o ultimo intervalo foi invalido (`<= 0`, nao finito) ou
   * excessivamente longo. Nesse caso a velocidade e zerada: nao se presume
   * movimento atraves de uma lacuna.
   */
  velocidadeValida: boolean;
  /** Intervalo (ms) efetivamente usado na ultima velocidade valida. */
  intervaloVelocidadeMs?: number;
  confianca: number;
  framesVisto: number;
  framesAusente: number;
  /** Quantas vezes o track foi reassociado depois de ter sido dado como perdido. */
  reassociacoes: number;
  primeiraObservacaoMs: number;
  ultimaObservacaoMs: number;
  /** Confianca na identidade (nao confundir com `estado` do ciclo de vida). */
  estadoIdentidade?: EstadoIdentidadeEntidade;
  /** Historico limitado de observacoes, do mais antigo ao mais recente. */
  historicoObservacoes?: ObservacaoEntidade[];
  meta: Record<string, unknown>;
}

/**
 * Associacao entre a sonda de um frame e a entidade rastreada.
 *
 * `indice` e a posicao da sonda na lista recebida por `atualizar` (o mesmo
 * indice da pessoa/mao no resultado do adaptador). Permite enriquecer as
 * observacoes por copia, sem depender de ordem de insercao do rastreador.
 */
export interface AssociacaoSonda {
  indice: number;
  entidadeId: string;
}

/** Resultado de uma atualizacao: entidades atualizadas e mapa sonda->entidade. */
export interface ResultadoRastreamento {
  entidades: Entidade[];
  associacoes: AssociacaoSonda[];
}
