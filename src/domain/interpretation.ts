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

/** Tipo fechado de acao sexual inferida em multiframe. */
export type TipoAcaoInterpretada =
  | "masturbacao"
  | "sexo_oral"
  | "penetracao"
  | "outra";

/**
 * Natureza da conclusao de acao:
 *
 * - `observada`: o ato e diretamente visivel em pelo menos um frame;
 * - `inferida`: a conclusao depende da sequencia/continuidade entre frames.
 *
 * Mesmo `observada` e leitura do modelo, nao um fato; `confianca` expressa o
 * grau de suporte. Nenhuma das duas transforma heuristica em certeza.
 */
export type NaturezaAcaoInterpretada = "observada" | "inferida";

/** Acao interpretada com seu intervalo temporal aproximado. */
export interface AcaoInterpretada {
  descricao: string;
  /** Tipo de acao sexual quando o modelo classifica (multiframe NSFW). */
  tipo?: TipoAcaoInterpretada;
  /** `observada` (visivel) ou `inferida` (dependente da sequencia). */
  natureza?: NaturezaAcaoInterpretada;
  /** Confianca do modelo em [0, 1] para a conclusao da acao. */
  confianca?: number;
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

/**
 * Pessoa adulta descrita na cena. `apresentacao` e leitura visual (como a
 * pessoa se apresenta na imagem), **nao** identidade de genero. A identidade so
 * e preenchida quando declarada explicitamente no conteudo/metadado; nunca e
 * inferida da aparencia.
 */
export interface ParticipanteInterpretado {
  /** Descricao visual do participante (ex.: `homem adulto`, `mulher adulta`). */
  descricao: string;
  /** Apresentacao visual observada; nao e identidade de genero. */
  apresentacao: "masculina" | "feminina" | "ambigua" | "nao_identificada";
  /** Identidade declarada explicitamente; ausente quando nao informada. */
  identidadeDeclarada?: "homem" | "mulher" | "pessoa_trans" | "nao_informada";
  /** IDs de frames/eventos que sustentam a descricao. */
  evidencias: string[];
  /** Referencias citadas que nao existem no contexto (removidas na validacao). */
  evidenciasInvalidas?: string[];
}

export interface ResultadoInterpretacao {
  /** Descricao textual em portugues. */
  resumo: string;
  /** Acoes interpretadas com intervalo temporal. */
  acoes: AcaoInterpretada[];
  /** Pessoas adultas descritas na cena (quando o modelo as separa). */
  participantes?: ParticipanteInterpretado[];
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
