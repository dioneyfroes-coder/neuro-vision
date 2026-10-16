/**
 * Resultado da interpretacao multimodal sobre um `PacoteCiclo` (roteiro 5.4).
 *
 * O interpretador recebe o pacote do ciclo; ele nunca captura uma imagem nova.
 */

/** Acao interpretada com seu intervalo temporal aproximado. */
export interface AcaoInterpretada {
  descricao: string;
  /** Instante ISO de inicio sugerido (quando o modelo fornece). */
  inicioEm?: string;
  /** Instante ISO de fim sugerido. */
  fimEm?: string;
  /** IDs de frames/eventos que sustentam a acao. */
  evidencias: string[];
}

export interface ResultadoInterpretacao {
  /** Descricao textual em portugues. */
  resumo: string;
  /** Acoes interpretadas com intervalo temporal. */
  acoes: AcaoInterpretada[];
  /** IDs de frames/eventos citados como suporte. */
  evidencias: string[];
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
}
