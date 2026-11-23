/**
 * Orçamento determinístico por perfil (Fase 5, plano §10.5).
 *
 * Limites **declarados** para contextos e resposta — não são medição de tokens
 * reais, latência ou RAM. O objetivo é evitar prompts ilimitados e deixar a
 * reducção de frames explícita e auditável. O tokenizer do backend continua
 * sendo a fonte da verdade para contagem exata.
 */

export type PerfilOrcamentoNsfw = "leve" | "equilibrado" | "completo";

export interface OrcamentoTokensNsfw {
  perfil: PerfilOrcamentoNsfw;
  /** Máximo de imagens por chamada. */
  maxFrames: number;
  /** Teto do contexto serializado em bytes UTF-8. */
  maxBytesContexto: number;
  /** Máximo de eventos temporais incluídos. */
  maxEventos: number;
  /** Máximo de marcações por frame no bloco NSFW. */
  maxMarcacoesPorFrame: number;
  /** Teto sugerido de tokens de resposta; não é medido. */
  tokensRespostaSugeridos: number;
}

export const PERFIS_ORCAMENTO_NSFW: readonly PerfilOrcamentoNsfw[] = [
  "leve",
  "equilibrado",
  "completo",
];

export const ORCAMENTOS_TOKENS_NSFW: Readonly<Record<PerfilOrcamentoNsfw, OrcamentoTokensNsfw>> =
  Object.freeze({
    leve: Object.freeze({
      perfil: "leve",
      maxFrames: 2,
      maxBytesContexto: 6_000,
      maxEventos: 6,
      maxMarcacoesPorFrame: 4,
      tokensRespostaSugeridos: 384,
    }),
    // Equilibrado reproduz os limites históricos: nada muda por padrão.
    equilibrado: Object.freeze({
      perfil: "equilibrado",
      maxFrames: 4,
      maxBytesContexto: 16_000,
      maxEventos: 20,
      maxMarcacoesPorFrame: 8,
      tokensRespostaSugeridos: 768,
    }),
    completo: Object.freeze({
      perfil: "completo",
      maxFrames: 8,
      maxBytesContexto: 32_000,
      maxEventos: 40,
      maxMarcacoesPorFrame: 16,
      tokensRespostaSugeridos: 1_536,
    }),
  });

export const PERFIL_ORCAMENTO_PADRAO: PerfilOrcamentoNsfw = "equilibrado";

export function normalizarPerfilOrcamentoNsfw(
  valor: unknown
): PerfilOrcamentoNsfw | undefined {
  return typeof valor === "string" &&
    (PERFIS_ORCAMENTO_NSFW as readonly string[]).includes(valor)
    ? (valor as PerfilOrcamentoNsfw)
    : undefined;
}

export function orcamentoTokensNsfw(
  perfil: PerfilOrcamentoNsfw | undefined | null = PERFIL_ORCAMENTO_PADRAO
): OrcamentoTokensNsfw {
  return { ...ORCAMENTOS_TOKENS_NSFW[perfil ?? PERFIL_ORCAMENTO_PADRAO] };
}

/** Converte o orçamento nos limites já usados pela montagem do contexto. */
export function limitesContextoDoOrcamento(
  orcamento: OrcamentoTokensNsfw
): { maxImagens: number; maxEventos: number; maxBytesContexto: number } {
  return {
    maxImagens: orcamento.maxFrames,
    maxEventos: orcamento.maxEventos,
    maxBytesContexto: orcamento.maxBytesContexto,
  };
}
