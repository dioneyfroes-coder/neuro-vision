/** Rotas de login/logout da autenticação opcional (Fase 7, plano §10). */
import type { IncomingMessage, ServerResponse } from "node:http";
import { COOKIE_SESSAO, atributosCookieSessao, criarCookieSessao, politicaAutenticacao, segredosIguais } from "./seguranca";
import type { PoliticaAutenticacao } from "./seguranca";
import type { RegistradorAuditoria } from "./auditoria";
import { readBody, sendJson } from "./base";

const LIMITE_CORPO_LOGIN = 4096;

export async function handleLogin(
  req: IncomingMessage,
  res: ServerResponse,
  politica: PoliticaAutenticacao,
  auditar: RegistradorAuditoria
): Promise<void> {
  if (!politica.obrigatoria || !politica.token) {
    sendJson(res, 400, { ok: false, erro: "autenticacao_desativada" });
    return;
  }
  let corpo: string;
  try {
    corpo = await readBody(req, LIMITE_CORPO_LOGIN);
  } catch {
    sendJson(res, 400, { ok: false, erro: "corpo_invalido" });
    return;
  }
  let token: unknown;
  try {
    token = (JSON.parse(corpo) as { token?: unknown }).token;
  } catch {
    token = undefined;
  }
  if (typeof token !== "string" || !segredosIguais(token, politica.token)) {
    auditar({ acao: "login_falha", resultado: "negado", detalhe: { via: "formulario" } });
    sendJson(res, 401, { ok: false, erro: "token_invalido" });
    return;
  }
  const agora = Date.now();
  const cookie = `${COOKIE_SESSAO}=${criarCookieSessao(politica.token, agora)}`;
  res.setHeader("Set-Cookie", `${cookie}; ${atributosCookieSessao()}`);
  auditar({ acao: "login_sucesso", resultado: "sucesso", ator: undefined, detalhe: { via: "formulario" } });
  sendJson(res, 200, { ok: true, redirecionar: "/" });
}

export function handleLogout(
  res: ServerResponse,
  ator: string,
  auditar: RegistradorAuditoria
): void {
  res.setHeader("Set-Cookie", `${COOKIE_SESSAO}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  auditar({ acao: "logout", resultado: "sucesso", ator });
  sendJson(res, 200, { ok: true });
}

/** Usado pelo CLI para avisar quando o token não foi configurado. */
export function tokenExigidoParaHost(host: string, hostsExpostos: (host: string) => boolean): boolean {
  return hostsExpostos(host) && !politicaAutenticacao().obrigatoria;
}
