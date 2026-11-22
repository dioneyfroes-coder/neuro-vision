import type { Ponto2D } from "../suavizador";

/** Grau de evidencia de uma interacao (mapeado para `EstadoEventoTemporal`). */
export type GrauInteracao = "incerto" | "provavel" | "confirmado";

/** Caixa normalizada pelo tamanho do frame (mesmo espaco dos landmarks). */
export interface CaixaNormalizada {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}

/**
 * Uma amostra por par (mao, objeto) em um frame. So existe quando **ambos** os
 * subsistemas (maos e deteccoes) produziram resultado: falha de inferencia e
 * tratada com `opcoes.indisponivel` em `processar`, nao como ausencia de par.
 */
export interface AmostraInteracao {
  sessionId: string;
  maoEntidadeId: string;
  objetoEntidadeId: string;
  /** Pessoa associada à mão no mesmo frame; ausente quando ambíguo. */
  pessoaEntidadeId?: string;
  rotuloObjeto?: string;
  /** Punho da mao (landmark 0), normalizado. */
  punhoMao: Ponto2D;
  /** Caixa do objeto normalizada pelo tamanho do frame. */
  caixaObjeto: CaixaNormalizada;
  confianca: number;
  frameId: string;
  timestamp: string;
  tempoMs: number;
  cycleId: string;
  /** `false` quando mão ou objeto nao foi visto neste frame (oclusao). */
  observado: boolean;
  /** `false` quando o intervalo/associacao nao pode ser validado. */
  continuidadeValida: boolean;
}

export interface ConfigInteracao {
  /** Distancia normalizada punho↔centro da caixa para contar como proximidade. */
  raioProximidade: number;
  /** Margem normalizada aplicada a caixa no teste de sobreposicao do punho. */
  margemCaixa: number;
  /** Confianca minima (mao e objeto) para a amostra entrar na regra. */
  confiancaMinima: number;
  /** Frames de proximidade sustentada antes de classificar como `provavel`. */
  framesParaProvavel: number;
  /** Frames de sobreposicao antes de permitir `confirmado` (com corroboracao). */
  framesParaContato: number;
  /** Deslocamento normalizado do objeto que conta como mudanca de estado. */
  deslocamentoMinimoObjeto: number;
  /** Intervalo maximo (ms) para o deslocamento do objeto ser confiavel. */
  intervaloMaximoMs: number;
  /** Frames sem evidencia antes de encerrar a interacao ativa. */
  framesParaEncerrar: number;
}

export const CONFIG_INTERACAO_PADRAO: ConfigInteracao = {
  raioProximidade: 0.15,
  margemCaixa: 0.02,
  confiancaMinima: 0.5,
  framesParaProvavel: 2,
  framesParaContato: 3,
  deslocamentoMinimoObjeto: 0.02,
  intervaloMaximoMs: 2000,
  framesParaEncerrar: 3,
};

/** Opcoes de `processar` para distinguir "sem par" de "nao foi possivel ver". */
export interface OpcoesProcessarInteracao {
  /**
   * `true` quando maos ou deteccoes falharam neste frame. A detectora congela
   * o estado (nao conta ausencia, nao confirma, nao encerra): uma inferencia
   * que falhou nao afirma que a interacao terminou.
   */
  indisponivel?: boolean;
}

export interface EstadoPar {
  chave: string;
  sessionId: string;
  maoEntidadeId: string;
  objetoEntidadeId: string;
  /** Última associação conhecida; um frame ambíguo não a apaga. */
  pessoaEntidadeId?: string;
  rotuloObjeto?: string;
  eventoId: string;
  inicioEm: string;
  cycleIdInicio: string;
  ultimaEvidenciaEm: string;
  ultimaObservacaoEm: string;
  frameIds: string[];
  evidencias: string[];
  confianca: number;
  grau: GrauInteracao;
  grauMaximo: GrauInteracao;
  /** Ja emitiu ao menos um evento neste ciclo de vida (evita encerrar o nunca visto). */
  emitido: boolean;
  framesProximidade: number;
  framesSobreposicao: number;
  framesSemSinal: number;
  continuidadeValida: boolean;
  /** Ultimo centro do objeto e o instante, para medir mudanca de estado. */
  ultimoCentro: Ponto2D | null;
  ultimoTempoMs: number | null;
  /** Quadros consecutivos em que o objeto foi visto sem se deslocar. */
  framesObjetoEstavel: number;
  /** `pego` so aparece na primeira promocao a `confirmado` deste par. */
  possePegoEmitida: boolean;
}

export const ORDEM_GRAU: Record<GrauInteracao, number> = {
  incerto: 0,
  provavel: 1,
  confirmado: 2,
};
