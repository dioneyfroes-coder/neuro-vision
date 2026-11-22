/**
 * Rotas aditivas da telemetria de atenção (Fase 3).
 *
 * `POST /api/monitoramento/seguranca/atencao` grava um estado, custo, conjunto
 * de zonas ou janela de evidência; `GET` devolve os registros da sessão. Nenhuma
 * rota altera sessão, quadros ou segmentos de vídeo.
 */
import { IncomingMessage } from "node:http";
import { ServerResponse } from "node:http";
import { ServicoAtencao } from "../monitoramento/servico-atencao";
import { ServicoMonitoramento } from "../monitoramento/servico-monitoramento";
import { BODY_MAX_BYTES, readBody, registrarFalha, sendJson } from "./base";
import { exigirSessaoMonitoramento } from "./rotas-cena";
import { inteiroLimitado } from "./validacao";
import { montarRegistroAtencao } from "./validacao/atencao";

export async function handleGravarAtencao(
  req: IncomingMessage,
  res: ServerResponse,
  atencao: ServicoAtencao,
  monitoramento: ServicoMonitoramento
): Promise<void> {
  let payload: unknown;
  try {
    payload = JSON.parse((await readBody(req, BODY_MAX_BYTES)) || "{}");
  } catch (err) {
    sendJson(res, 400, { ok: false, erro: (err as Error).message });
    return;
  }
  const registro = montarRegistroAtencao(payload);
  if (typeof registro === "string") {
    sendJson(res, 400, { ok: false, erro: registro });
    return;
  }
  try {
    if (!(await exigirSessaoMonitoramento(res, monitoramento, registro.sessaoId))) return;
    await atencao.registrar(registro);
    sendJson(res, 200, { ok: true, registro });
  } catch (err) {
    registrarFalha("error", "atencao_monitoramento_falhou", { erro: (err as Error).message });
    sendJson(res, 500, { ok: false, erro: (err as Error).message });
  }
}

/** `GET /api/monitoramento/seguranca/atencao?sessaoId=...&limit=...` */
export async function handleListarAtencao(
  req: IncomingMessage,
  res: ServerResponse,
  atencao: ServicoAtencao
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/api/monitoramento/seguranca/atencao", "http://localhost");
    const sessaoId = url.searchParams.get("sessaoId") ?? undefined;
    const limite = inteiroLimitado(url.searchParams.get("limit"), 500, 1, 2_000);
    const registros = await atencao.listar(sessaoId, limite);
    sendJson(res, 200, { ok: true, total: registros.length, registros });
  } catch (err) {
    registrarFalha("error", "listar_atencao_falhou", { erro: (err as Error).message });
    sendJson(res, 500, { ok: false, erro: (err as Error).message });
  }
}
