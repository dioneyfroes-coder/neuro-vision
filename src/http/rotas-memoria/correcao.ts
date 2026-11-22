/**
 * `POST /api/eventos-temporais/:eventoId/corrigir` — correção humana auditável.
 *
 * A correção não apaga nem reescreve a versão anterior: uma nova versão é
 * anexada ao mesmo stream append-only, com autor, motivo, instante e o valor
 * original dos campos alterados. `statusEvidencia`, tempo, identidade e ciclo de
 * vida continuam derivados pelo servidor.
 */
import { IncomingMessage } from "node:http";
import type { ServerResponse } from "node:http";
import { aplicarCorrecaoEvento, validarPedidoCorrecao } from "../../domain";
import { appendEventoTemporal, lerEventosTemporais, montarEventoTemporal } from "../persistencia";
import { BODY_MAX_BYTES, readBody, registrarFalha, sendJson } from "../base";

const LIMITE_HISTORICO = 5_000;

function eventoIdDaRota(url: URL): string | undefined {
  const casa = /^\/api\/eventos-temporais\/([^/]+)\/corrigir$/.exec(url.pathname);
  if (!casa) return undefined;
  try {
    return decodeURIComponent(casa[1]);
  } catch {
    return undefined;
  }
}

export async function handleCorrigirEventoTemporal(
  req: IncomingMessage,
  res: ServerResponse,
  eventosTemporaisFile: string
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/api/eventos-temporais", "http://localhost");
    const eventoId = eventoIdDaRota(url);
    if (!eventoId) {
      sendJson(res, 400, { ok: false, erro: "eventoId inválido na rota" });
      return;
    }
    const pedido = validarPedidoCorrecao(JSON.parse((await readBody(req, BODY_MAX_BYTES)) || "{}"));
    if (!pedido || pedido.eventoId !== eventoId) {
      sendJson(res, 400, {
        ok: false,
        erro:
          "correção inválida: exige eventoId da rota, corrigidoPor, motivo e ao menos um campo alterado conhecido",
      });
      return;
    }
    const historico = await lerEventosTemporais(eventosTemporaisFile, LIMITE_HISTORICO);
    const anterior = historico.find((evento) => evento.eventoId === eventoId);
    if (!anterior) {
      sendJson(res, 404, { ok: false, erro: "evento não encontrado" });
      return;
    }
    const corrigidoEm = new Date().toISOString();
    const versao = (anterior.correcao?.versao ?? 0) + 1;
    const corrigido = aplicarCorrecaoEvento(anterior, pedido, corrigidoEm);
    const persistivel = montarEventoTemporal({
      ...corrigido,
      idempotencyKey: `${eventoId}:correcao:${versao}`,
      registradoEm: corrigidoEm,
    });
    if (!persistivel) {
      sendJson(res, 400, { ok: false, erro: "evento corrigido não passou na validação" });
      return;
    }
    await appendEventoTemporal(persistivel, eventosTemporaisFile);
    sendJson(res, 200, { ok: true, evento: persistivel, versao });
  } catch (err) {
    registrarFalha("error", "corrigir_evento_falhou", { erro: (err as Error).message });
    sendJson(res, 400, { ok: false, erro: (err as Error).message });
  }
}
