import { IncomingMessage } from "node:http";
import { ServerResponse } from "node:http";
import { filtrarEventos } from "../../memoria";
import { montarEvento } from "../../memoria";
import { montarOperacional } from "../../memoria";
import { reidratarContexto } from "../../memoria";
import { eventoJaRegistrado } from "../../persistence/repositorio-eventos";
import { marcarEventoRegistrado } from "../../persistence/repositorio-eventos";
import { ServicoMonitoramento } from "../../monitoramento/servico-monitoramento";
import { EventoVisualComVideo } from "../../types";
import { BODY_MAX_BYTES, arquivosDeMemoria, readBody, registrarFalha, sendJson } from "../base";
import {
  agendarLimpezaSnapshots,
  appendEvento,
  appendOperacional,
  lerEventos,
  lerLogEntries,
  limparEventos,
  limparSnapshots,
  salvarSnapshot,
} from "../persistencia";
import { inteiroLimitado, parsearInstante, parsearTiposEvento, validarPayloadEvento } from "../validacao";
import { anexarTrechosDeVideo } from "./video";

export async function handleEventos(
  req: IncomingMessage,
  res: ServerResponse,
  eventosFile: string,
  snapDir: string,
  logFile: string
): Promise<void> {
  try {
    const raw = await readBody(req, BODY_MAX_BYTES);
    const payload: unknown = JSON.parse(raw || "{}");
    const erro = validarPayloadEvento(payload);
    if (erro) {
      sendJson(res, 400, { ok: false, erro });
      return;
    }
    const evento = montarEvento(payload);
    if (!evento) {
      sendJson(res, 400, { ok: false, erro: "evento invalido (tipo ou origem desconhecidos)" });
      return;
    }
    // Idempotencia (Fase 6C): o reenvio da mesma requisicao pela fila do cliente
    // nao acrescenta um evento duplicado nem regrava o snapshot.
    const chave = evento.idempotencyKey;
    if (chave && eventoJaRegistrado(eventosFile, chave)) {
      sendJson(res, 200, { ok: true, evento, duplicado: true });
      return;
    }
    const p = payload as Record<string, unknown>;
    const snapshot = await salvarSnapshot(p.snapshot, snapDir);
    if (snapshot) evento.snapshot = snapshot;
    await appendEvento(evento, eventosFile);
    if (chave) marcarEventoRegistrado(eventosFile, chave);
    if (snapshot) agendarLimpezaSnapshots(snapDir, logFile, eventosFile);
    sendJson(res, 200, { ok: true, evento });
  } catch (err) {
    sendJson(res, 400, { ok: false, erro: (err as Error).message });
  }
}

export async function handleListEventos(
  req: IncomingMessage,
  res: ServerResponse,
  eventosFile: string,
  monitoramento: ServicoMonitoramento
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/api/eventos", "http://localhost");
    const limitParam = Number(url.searchParams.get("limit"));
    const limite = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 500) : 100;
    // Filtros (Fase 4): "o que mudou" (`tipo`/`objetoId`) e "quando"
    // (`desde`/`ate`, aceitando epoch ms ou ISO). Aplicados aos eventos mais
    // recentes dentro de `limit`.
    const filtrados = filtrarEventos(await lerEventos(eventosFile, limite), {
      tipos: parsearTiposEvento(url.searchParams.get("tipo")),
      objetoId: url.searchParams.get("objetoId")?.trim() || undefined,
      desdeMs: parsearInstante(url.searchParams.get("desde")),
      ateMs: parsearInstante(url.searchParams.get("ate")),
    });
    const eventos: EventoVisualComVideo[] = await anexarTrechosDeVideo(
      filtrados,
      (evento) => evento.timestamp,
      monitoramento
    );
    sendJson(res, 200, { ok: true, total: eventos.length, eventos });
  } catch (err) {
    registrarFalha("error", "listar_eventos_falhou", { erro: (err as Error).message });
    sendJson(res, 500, { ok: false, erro: (err as Error).message });
  }
}

export async function handleClearEventos(
  res: ServerResponse,
  eventosFile: string,
  snapDir: string,
  logFile: string
): Promise<void> {
  try {
    await limparEventos(eventosFile);
    const snapshots = await limparSnapshots({
      snapDir,
      logFiles: arquivosDeMemoria(logFile, eventosFile),
    });
    sendJson(res, 200, { ok: true, snapshots });
  } catch (err) {
    registrarFalha("error", "limpar_eventos_falhou", { erro: (err as Error).message });
    sendJson(res, 500, { ok: false, erro: (err as Error).message });
  }
}

/**
 * `GET /api/contexto` — reconstroi um contexto curto do estado recente a partir
 * do historico e dos eventos persistidos, com janelas limitadas por tamanho e
 * contagem para nao enviar indefinidamente todo o historico ao modelo.
 */
export async function handleContexto(
  req: IncomingMessage,
  res: ServerResponse,
  logFile: string,
  eventosFile: string
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/api/contexto", "http://localhost");
    const maxEntradas = inteiroLimitado(url.searchParams.get("maxEntradas"), 20, 1, 200);
    const maxEventos = inteiroLimitado(url.searchParams.get("maxEventos"), 20, 0, 200);
    const maxCaracteres = inteiroLimitado(url.searchParams.get("maxCaracteres"), 1200, 200, 8000);
    const sessionId = url.searchParams.get("sessionId")?.trim() || undefined;
    // Com filtro, apenas registros explicitamente marcados com essa sessao.
    // Sem filtro, registros legados sem sessao continuam no contexto global.
    const daSessao = (valor: string | undefined) =>
      sessionId ? valor === sessionId : true;
    const entradas = (await lerLogEntries(logFile, maxEntradas)).filter((e) =>
      daSessao(e.sessaoId)
    );
    const eventos = (await lerEventos(eventosFile, maxEventos)).filter((e) =>
      daSessao(e.sessaoId)
    );
    const contexto = reidratarContexto(entradas, eventos, {
      maxEntradas,
      maxEventos,
      maxCaracteres,
    });
    sendJson(res, 200, { ok: true, sessionId, ...contexto });
  } catch (err) {
    registrarFalha("error", "contexto_falhou", { erro: (err as Error).message });
    sendJson(res, 500, { ok: false, erro: (err as Error).message });
  }
}

export async function handleOperacional(
  req: IncomingMessage,
  res: ServerResponse,
  operacionalFile: string
): Promise<void> {
  try {
    const raw = await readBody(req, BODY_MAX_BYTES);
    const payload: unknown = JSON.parse(raw || "{}");
    const registro = montarOperacional(payload);
    if (!registro) {
      sendJson(res, 400, { ok: false, erro: "campo 'mensagem' obrigatorio" });
      return;
    }
    await appendOperacional(registro, operacionalFile);
    sendJson(res, 200, { ok: true, registro });
  } catch (err) {
    sendJson(res, 400, { ok: false, erro: (err as Error).message });
  }
}
