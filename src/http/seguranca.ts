/**
 * Autenticação opcional de acesso remoto (Fase 7, plano §10).
 *
 * O servidor continua utilizável em loopback sem configuração. Ao definir
 * `NEURO_API_TOKEN`, **toda** requisição (API, snapshots e estáticos) exige
 * Bearer ou cookie de sessão assinado. O token nunca aparece em log, cookie ou
 * auditoria: a trilha registra apenas um resumo SHA-256 de 12 caracteres.
 */
import crypto from "node:crypto";
import type { IncomingMessage } from "node:http";
import { env } from "../env";

export const COOKIE_SESSAO = "neuro_sessao";
export const DURACAO_SESSAO_MS = 12 * 60 * 60 * 1000;

export interface PoliticaAutenticacao {
  /** Token em texto claro, fornecido pelo operador. Nunca deve ser logado. */
  token?: string;
  /** `true` quando um token está configurado. */
  obrigatoria: boolean;
}

export interface IdentidadeAutenticacao {
  autenticada: boolean;
  /** `anonimo` ou `token:<sha256-12>`; nunca o segredo em si. */
  ator: string;
}

interface ConteudoSessao {
  sub: string;
  iat: number;
  exp: number;
}

export function politicaAutenticacao(token: string | undefined = env.NEURO_API_TOKEN): PoliticaAutenticacao {
  const limpo = typeof token === "string" ? token.trim() : "";
  return limpo ? { token: limpo, obrigatoria: true } : { obrigatoria: false };
}

export function identificadorAtor(token: string | undefined): string {
  if (!token) return "anonimo";
  const resumo = crypto.createHash("sha256").update(token).digest("hex").slice(0, 12);
  return `token:${resumo}`;
}

/** Comparação de segredos com tempo constante (ambos passam por hash primeiro). */
export function segredosIguais(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function assinar(conteudo: string, chave: string): string {
  return crypto.createHmac("sha256", chave).update(conteudo).digest("base64url");
}

export function criarCookieSessao(
  token: string,
  agoraMs = Date.now(),
  duracaoMs = DURACAO_SESSAO_MS
): string {
  const conteudo: ConteudoSessao = {
    sub: identificadorAtor(token),
    iat: agoraMs,
    exp: agoraMs + duracaoMs,
  };
  const corpo = Buffer.from(JSON.stringify(conteudo), "utf8").toString("base64url");
  return `${corpo}.${assinar(corpo, token)}`;
}

export function validarCookieSessao(
  valor: string | undefined,
  token: string,
  agoraMs = Date.now()
): boolean {
  if (!valor) return false;
  const partes = valor.split(".");
  if (partes.length !== 2) return false;
  const [corpo, assinatura] = partes;
  const esperada = assinar(corpo, token);
  if (!segredosIguais(assinatura, esperada)) return false;
  try {
    const conteudo = JSON.parse(Buffer.from(corpo, "base64url").toString("utf8")) as ConteudoSessao;
    return (
      conteudo.sub === identificadorAtor(token) &&
      Number.isFinite(conteudo.exp) &&
      Number.isFinite(conteudo.iat) &&
      conteudo.exp > agoraMs
    );
  } catch {
    return false;
  }
}

function valorCookie(cabecalho: string | undefined, nome: string): string | undefined {
  if (!cabecalho) return undefined;
  for (const parte of cabecalho.split(";")) {
    const [chave, ...resto] = parte.trim().split("=");
    if (chave === nome) return resto.join("=");
  }
  return undefined;
}

/** Avalia Bearer e cookie; a política desligada preserva o comportamento antigo. */
export function autenticarRequisicao(
  req: IncomingMessage,
  politica: PoliticaAutenticacao,
  agoraMs = Date.now()
): IdentidadeAutenticacao {
  if (!politica.obrigatoria || !politica.token) {
    return { autenticada: true, ator: "anonimo" };
  }
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "");
  if (bearer && segredosIguais(bearer[1].trim(), politica.token)) {
    return { autenticada: true, ator: identificadorAtor(politica.token) };
  }
  const cookie = valorCookie(req.headers.cookie, COOKIE_SESSAO);
  if (validarCookieSessao(cookie, politica.token, agoraMs)) {
    return { autenticada: true, ator: identificadorAtor(politica.token) };
  }
  return { autenticada: false, ator: "anonimo" };
}

/** Atributos do cookie; `Secure` é opt-in para quem termina em HTTPS. */
export function atributosCookieSessao(): string {
  const seguro = env.NEURO_HTTPS ? "; Secure" : "";
  return `HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(DURACAO_SESSAO_MS / 1000)}${seguro}`;
}
