/**
 * Resultado da interpretacao multimodal sobre um `PacoteCiclo` (roteiro 5.4).
 *
 * O interpretador recebe o pacote do ciclo; ele nunca captura uma imagem nova.
 */

/** Grupo de evidencia removido do contexto para respeitar o teto de bytes. */
export interface GrupoRemovidoContexto {
  /** Nome estavel do grupo (ex.: `keypoints`, `eventos_nao_confirmados`). */
  grupo: string;
  /** Quantidade de itens removidos do grupo. */
  removidos: number;
}

/**
 * Diagnostico do contexto efetivamente enviado ao modelo (Fase 3).
 *
 * Registra se houve compactacao, quanto do payload foi medido e quais grupos
 * foram podados. Fica nas metricas do ciclo para que a frequencia real de
 * truncamento seja auditavel a partir de `ciclos.jsonl`.
 */
export interface DiagnosticoContextoMultimodal {
  /** Bytes UTF-8 do contexto enviado (inclui o proprio registro de truncamento). */
  bytes: number;
  /** Teto configurado para o contexto, em bytes UTF-8. */
  maxBytes: number;
  /** `true` quando alguma reducao foi aplicada. */
  truncado: boolean;
  /** `true` quando o payload continuou acima do teto apos todas as reducoes. */
  excedeuTeto: boolean;
  gruposRemovidos: GrupoRemovidoContexto[];
}

/** Acao interpretada com seu intervalo temporal aproximado. */
export interface AcaoInterpretada {
  descricao: string;
  /** Instante ISO de inicio sugerido (quando o modelo fornece). */
  inicioEm?: string;
  /** Instante ISO de fim sugerido. */
  fimEm?: string;
  /** IDs de frames/eventos que sustentam a acao. */
  evidencias: string[];
  /**
   * Referencias citadas pelo modelo que **nao** correspondem a nenhum frame ou
   * evento real do contexto (removidas de `evidencias` na validacao).
   */
  evidenciasInvalidas?: string[];
}

export interface ResultadoInterpretacao {
  /** Descricao textual em portugues. */
  resumo: string;
  /** Acoes interpretadas com intervalo temporal. */
  acoes: AcaoInterpretada[];
  /** IDs de frames/eventos citados como suporte. */
  evidencias: string[];
  /**
   * Referencias citadas pelo modelo que nao existem no contexto (rejeitadas ou
   * normalizadas). Mantidas separadas para diagnostico.
   */
  evidenciasInvalidas?: string[];
  /** O que nao foi possivel verificar. */
  incertezas: string[];
  /** Conflitos entre a interpretacao e os dados locais. */
  contradicoes: string[];
  /** Modelo que produziu a interpretacao. */
  modelo?: string;
  /** Duracao da chamada em ms. */
  duracaoMs?: number;
  /** Texto bruto quando a saida estruturada nao foi possivel validar. */
  bruto?: string;
  /** Compactacao do contexto enviado (tamanho, grupos podados e teto). */
  contextoMultimodal?: DiagnosticoContextoMultimodal;
}
