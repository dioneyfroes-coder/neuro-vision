export const CONDICOES_ALVO = ["oclusao_parcial", "contraluz", "ambiente_escuro"] as const;

export type CondicaoAlvo = (typeof CONDICOES_ALVO)[number];

/** Classes que indicam que a política classificou mal uma condição degradada. */
export const CLASSES_POLITICA_INCORRETA = [
  "movimento",
  "nova_entidade",
  "desaparecimento",
] as const;

export type ClassificacaoEvento =
  | "baixa_confianca"
  | (typeof CLASSES_POLITICA_INCORRETA)[number]
  | "resumo"
  | "outro";

/** Um intervalo anotado em ms desde o início do clipe. */
export interface IntervaloCondicao {
  inicioMs: number;
  fimMs: number;
}

/** Verdade-base humana para uma condição em um clipe. */
export interface AnotacaoCondicao extends IntervaloCondicao {
  condicao: CondicaoAlvo;
  /** `false` exclui o intervalo de precisão/recall e o conta à parte. */
  determinavel?: boolean;
  visibilidade?: "clara" | "parcial" | "ocluida" | "impossivel_de_determinar";
}

/** Anotação completa de um clipe. `revisada` é o gate de evidência. */
export interface AnotacaoClipCondicoes {
  clip: string;
  duracaoMs: number;
  revisada: boolean;
  metodoRevisao?: string;
  eventos: AnotacaoCondicao[];
}

/** Evento observado, com o instante em ms desde o início do clipe. */
export interface EventoCondicao {
  clip: string;
  classe: ClassificacaoEvento;
  emMs: number;
  /** Opcional: intervalo real do evento; quando ausente, é tratado como ponto. */
  inicioMs?: number;
  fimMs?: number;
  motivo?: string;
}

export interface OpcoesAvaliacaoCondicoes {
  /** Coeficiente de sobreposição mínimo (interseção / menor intervalo). */
  sobreposicaoMinima?: number;
  /** Tolerância aplicada ao evento para compensar a cadência de amostragem. */
  toleranciaMs?: number;
  ocorrenciasMinimas?: number;
  clipesNegativosMinimos?: number;
  maxFalsosPositivosPorMinuto?: number;
  minPrecisao?: number;
  minRecall?: number;
  condicoes?: readonly CondicaoAlvo[];
}

export interface CorrespondenciaCondicao {
  anotacaoIndex: number;
  eventoIndex: number;
  sobreposicao: number;
}

export interface ResultadoCondicao {
  condicao: CondicaoAlvo;
  esperados: number;
  acertos: number;
  falsosPositivos: number;
  falsosNegativos: number;
  indeterminados: number;
  precisao: number | null;
  recall: number | null;
  falsosPositivosPorMinuto: number;
  violacoesPolitica: number;
  correspondencias: CorrespondenciaCondicao[];
}

export type VereditoCondicoes = "APROVADO" | "REPROVADO" | "INCONCLUSIVO";

export interface ResultadoAvaliacaoCondicoes {
  porCondicao: Record<CondicaoAlvo, ResultadoCondicao>;
  /** Falhas de métrica vêm primeiro; pendências de dados vêm depois. */
  problemas: string[];
  veredito: VereditoCondicoes;
}
