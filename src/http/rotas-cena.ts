/**
 * Rotas da referencia de ambiente e da comparacao de cena.
 *
 * Extraido de `src/server.ts` na refatoracao de responsabilidades.
 */
import { IncomingMessage } from "node:http";
import { ServerResponse } from "node:http";
import { ServicoMonitoramento } from "../monitoramento/servico-monitoramento";
import { SemMudancaCenaError, SemReferenciaCenaError } from "../monitoramento/servico-cena";
import { ServicoCena } from "../monitoramento/servico-cena";

import { BODY_MAX_BYTES, readBody, registrarFalha, sendJson } from "./base";
import {
  inteiroLimitado,
  lerInstanteDoCorpo,
  montarComparacaoCena,
  montarConsolidacaoCena,
  montarItensCena,
  numeroPositivoOuErro,
} from "./validacao";

export function responderErroCena(res: ServerResponse, err: unknown): void {
  if (err instanceof SemReferenciaCenaError) {
    sendJson(res, 409, { ok: false, erro: err.message });
    return;
  }
  if (err instanceof SemMudancaCenaError) {
    sendJson(res, 404, { ok: false, erro: err.message });
    return;
  }
  registrarFalha("error", "cena_monitoramento_falhou", { erro: (err as Error).message });
  sendJson(res, 500, { ok: false, erro: (err as Error).message });
}

export async function exigirSessaoMonitoramento(
  res: ServerResponse,
  monitoramento: ServicoMonitoramento,
  sessaoId: string
): Promise<boolean> {
  const sessoes = await monitoramento.listarSessoes();
  if (sessoes.some((sessao) => sessao.sessaoId === sessaoId)) return true;
  sendJson(res, 404, { ok: false, erro: "Sessao de monitoramento desconhecida" });
  return false;
}

/** `POST .../cena/referencia` - consolida o inventario inicial. */
export async function handleReferenciaCena(
  req: IncomingMessage,
  res: ServerResponse,
  cena: ServicoCena,
  monitoramento: ServicoMonitoramento,
  sessaoId: string
): Promise<void> {
  let payload: unknown;
  try {
    payload = JSON.parse((await readBody(req, BODY_MAX_BYTES)) || "{}");
  } catch (err) {
    sendJson(res, 400, { ok: false, erro: (err as Error).message });
    return;
  }
  const itens = montarItensCena(payload);
  if (typeof itens === "string") {
    sendJson(res, 400, { ok: false, erro: itens });
    return;
  }
  const p = payload as Record<string, unknown>;
  const criado = lerInstanteDoCorpo(p.criadaEmMs);
  if (criado !== undefined && !Number.isFinite(criado)) {
    sendJson(res, 400, { ok: false, erro: "campo 'criadaEmMs' deve ser finito" });
    return;
  }
  const quadros = numeroPositivoOuErro(p.quadros, "quadros");
  if (typeof quadros === "string") {
    sendJson(res, 400, { ok: false, erro: quadros });
    return;
  }
  const consolidacao = montarConsolidacaoCena(payload);
  if (!consolidacao.ok) {
    sendJson(res, 400, { ok: false, erro: consolidacao.erro });
    return;
  }
  try {
    if (!(await exigirSessaoMonitoramento(res, monitoramento, sessaoId))) return;
    const referencia = await cena.definirReferencia({
      sessaoId,
      itens,
      criadaEmMs: criado ?? Date.now(),
      ...(quadros !== undefined ? { quadros } : {}),
      ...(consolidacao.valor ? { consolidacao: consolidacao.valor } : {}),
    });
    sendJson(res, 200, { ok: true, referencia });
  } catch (err) {
    responderErroCena(res, err);
  }
}

/** `GET .../cena/referencia` - ultima referencia conhecida (pode ser `null`). */
export async function handleObterReferenciaCena(
  res: ServerResponse,
  cena: ServicoCena,
  monitoramento: ServicoMonitoramento,
  sessaoId: string
): Promise<void> {
  try {
    if (!(await exigirSessaoMonitoramento(res, monitoramento, sessaoId))) return;
    const referencia = await cena.obterReferencia(sessaoId);
    sendJson(res, 200, { ok: true, referencia });
  } catch (err) {
    responderErroCena(res, err);
  }
}

/** `POST .../cena/comparar` - compara, persiste mudancas novas e devolve ambas. */
export async function handleCompararCena(
  req: IncomingMessage,
  res: ServerResponse,
  cena: ServicoCena,
  monitoramento: ServicoMonitoramento,
  sessaoId: string
): Promise<void> {
  let payload: unknown;
  try {
    payload = JSON.parse((await readBody(req, BODY_MAX_BYTES)) || "{}");
  } catch (err) {
    sendJson(res, 400, { ok: false, erro: (err as Error).message });
    return;
  }
  const itens = montarItensCena(payload);
  if (typeof itens === "string") {
    sendJson(res, 400, { ok: false, erro: itens });
    return;
  }
  const p = payload as Record<string, unknown>;
  const agora = lerInstanteDoCorpo(p.agoraMs);
  if (agora !== undefined && !Number.isFinite(agora)) {
    sendJson(res, 400, { ok: false, erro: "campo 'agoraMs' deve ser finito" });
    return;
  }
  const comparacao = montarComparacaoCena(payload);
  if (typeof comparacao === "string") {
    sendJson(res, 400, { ok: false, erro: comparacao });
    return;
  }
  const confirmarRepeticao = p.confirmarRepeticao;
  if (confirmarRepeticao !== undefined && typeof confirmarRepeticao !== "boolean") {
    sendJson(res, 400, { ok: false, erro: "campo 'confirmarRepeticao' deve ser booleano" });
    return;
  }
  const minimoConfirmacoes = numeroPositivoOuErro(p.minimoConfirmacoes, "minimoConfirmacoes");
  if (typeof minimoConfirmacoes === "string") {
    sendJson(res, 400, { ok: false, erro: minimoConfirmacoes });
    return;
  }
  try {
    if (!(await exigirSessaoMonitoramento(res, monitoramento, sessaoId))) return;
    const resultado = await cena.comparar({
      sessaoId,
      itens,
      detectadoEmMs: agora ?? Date.now(),
      comparacao,
      ...(confirmarRepeticao !== undefined ? { confirmarRepeticao } : {}),
      ...(minimoConfirmacoes !== undefined ? { minimoConfirmacoes } : {}),
    });
    sendJson(res, 200, { ok: true, ...resultado });
  } catch (err) {
    responderErroCena(res, err);
  }
}

/** `GET .../cena/mudancas?limit=` - linha do tempo de mudancas da sessao. */
export async function handleListarMudancasCena(
  req: IncomingMessage,
  res: ServerResponse,
  cena: ServicoCena,
  monitoramento: ServicoMonitoramento,
  sessaoId: string
): Promise<void> {
  try {
    if (!(await exigirSessaoMonitoramento(res, monitoramento, sessaoId))) return;
    const url = new URL(req.url ?? "/", "http://localhost");
    const limite = inteiroLimitado(url.searchParams.get("limit"), 2000, 1, 5000);
    const mudancas = await cena.listarMudancas(sessaoId, limite);
    sendJson(res, 200, { ok: true, total: mudancas.length, mudancas });
  } catch (err) {
    responderErroCena(res, err);
  }
}

/** `POST .../cena/confirmar` - aprova ou rejeita uma mudança na revisão. */
export async function handleRevisarMudancaCena(
  req: IncomingMessage,
  res: ServerResponse,
  cena: ServicoCena,
  monitoramento: ServicoMonitoramento,
  sessaoId: string
): Promise<void> {
  let payload: unknown;
  try {
    payload = JSON.parse((await readBody(req, BODY_MAX_BYTES)) || "{}");
  } catch (err) {
    sendJson(res, 400, { ok: false, erro: (err as Error).message });
    return;
  }
  const p = payload as Record<string, unknown>;
  if (typeof p.mudancaId !== "string" || p.mudancaId.trim().length === 0) {
    sendJson(res, 400, { ok: false, erro: "campo 'mudancaId' obrigatorio" });
    return;
  }
  if (p.decisao !== "confirmada" && p.decisao !== "rejeitada") {
    sendJson(res, 400, { ok: false, erro: "campo 'decisao' deve ser confirmada ou rejeitada" });
    return;
  }
  const agora = lerInstanteDoCorpo(p.agoraMs);
  if (agora !== undefined && !Number.isFinite(agora)) {
    sendJson(res, 400, { ok: false, erro: "campo 'agoraMs' deve ser finito" });
    return;
  }
  try {
    if (!(await exigirSessaoMonitoramento(res, monitoramento, sessaoId))) return;
    const mudanca = await cena.revisar({
      sessaoId,
      mudancaId: p.mudancaId,
      decisao: p.decisao,
      agoraMs: agora ?? Date.now(),
    });
    sendJson(res, 200, { ok: true, mudanca });
  } catch (err) {
    responderErroCena(res, err);
  }
}

/** Reconhece `/api/monitoramento/sessoes/:id/cena/{referencia,comparar,mudancas,confirmar}`. */
export function rotaCenaMonitoramento(
  pathname: string
): { sessaoId: string; acao: "referencia" | "comparar" | "mudancas" | "confirmar" } | null {
  const encontrada =
    /^\/api\/monitoramento\/sessoes\/([^/]+)\/cena\/(referencia|comparar|mudancas|confirmar)$/.exec(
      pathname
    );
  if (!encontrada) return null;
  return {
    sessaoId: decodeURIComponent(encontrada[1]),
    acao: encontrada[2] as "referencia" | "comparar" | "mudancas" | "confirmar",
  };
}
