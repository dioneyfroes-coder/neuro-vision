/**
 * Contrato canônico de auditoria de acesso a dados sensíveis (Fase 7).
 *
 * Um registro de auditoria responde **quem** fez **o quê**, **a qual alvo**,
 * **quando** e **com que resultado**. Ele nunca guarda bytes de vídeo, tokens,
 * senhas ou cookies. A trilha é append-only; correções em fatos continuam no
 * subsistema próprio (`correcao-evento.ts`) — este módulo não cria formato de
 * evento visual nem substitui o log operacional.
 */
/**
 * Gerador de id compatível com navegador e Node: o barril de `domain` também é
 * importado pelo cliente, então este módulo não pode depender de `node:crypto`.
 */
function novoRegistroId(): string {
  const cripto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cripto?.randomUUID) return cripto.randomUUID();
  return `aud-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const VERSAO_REGISTRO_AUDITORIA = 1 as const;

export type AcaoAuditoria =
  | "acesso_video"
  | "exportacao_eventos"
  | "exclusao_video"
  | "exclusao_videos_sessao"
  | "exclusao_logs"
  | "limpeza_eventos"
  | "limpeza_eventos_temporais"
  | "aplicacao_retencao"
  | "recuperacao_monitoramento"
  | "login_sucesso"
  | "login_falha"
  | "logout"
  | "acesso_negado";

export type ResultadoAuditoria = "sucesso" | "falha" | "negado";

export type ValorDetalheAuditoria = string | number | boolean | null;

export interface RegistroAuditoria {
  schemaVersion: typeof VERSAO_REGISTRO_AUDITORIA;
  registroId: string;
  timestamp: string;
  acao: AcaoAuditoria;
  resultado: ResultadoAuditoria;
  /** Identificador não reversível do ator (`anonimo` ou `token:<sha256-12>`). */
  ator: string;
  alvo?: string;
  detalhe?: Record<string, ValorDetalheAuditoria>;
}

export interface OpcoesRegistroAuditoria {
  acao: AcaoAuditoria;
  resultado: ResultadoAuditoria;
  ator: string;
  alvo?: string;
  detalhe?: Record<string, unknown>;
}

/** Callback usado por qualquer camada que precise registrar uma ação. */
export interface RegistradorAuditoria {
  (opcoes: {
    acao: AcaoAuditoria;
    resultado: ResultadoAuditoria;
    ator?: string;
    alvo?: string;
    detalhe?: Record<string, unknown>;
  }): void;
}

const CHAVES_SENSIVEIS = /(token|senha|password|secret|authorization|cookie|chave|key)/i;

/**
 * Remove valores que não devem entrar na trilha. Aceita apenas escalares e
 * descarta chaves sensíveis mesmo quando o chamador as inclui por engano.
 */
export function detalheSeguroAuditoria(
  detalhe: Record<string, unknown> | undefined
): Record<string, ValorDetalheAuditoria> | undefined {
  if (!detalhe) return undefined;
  const seguro: Record<string, ValorDetalheAuditoria> = {};
  for (const [chave, valor] of Object.entries(detalhe)) {
    if (CHAVES_SENSIVEIS.test(chave)) continue;
    if (typeof valor === "string" || typeof valor === "number" || typeof valor === "boolean") {
      seguro[chave] = valor;
    } else if (valor === null) {
      seguro[chave] = null;
    }
  }
  return Object.keys(seguro).length > 0 ? seguro : undefined;
}

/** Cria um registro com timestamp e id injetáveis (determinismo nos testes). */
export function criarRegistroAuditoria(
  opcoes: OpcoesRegistroAuditoria,
  agora = new Date(),
  registroId = novoRegistroId()
): RegistroAuditoria {
  const ator = typeof opcoes.ator === "string" && opcoes.ator ? opcoes.ator : "anonimo";
  const detalhe = detalheSeguroAuditoria(opcoes.detalhe);
  return {
    schemaVersion: VERSAO_REGISTRO_AUDITORIA,
    registroId,
    timestamp: agora.toISOString(),
    acao: opcoes.acao,
    resultado: opcoes.resultado,
    ator,
    ...(opcoes.alvo ? { alvo: opcoes.alvo } : {}),
    ...(detalhe ? { detalhe } : {}),
  };
}
