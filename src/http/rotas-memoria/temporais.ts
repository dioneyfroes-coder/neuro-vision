import { IncomingMessage } from "node:http";
import { ServerResponse } from "node:http";
import { eventoJaRegistrado } from "../../persistence/repositorio-eventos";
import { marcarEventoRegistrado } from "../../persistence/repositorio-eventos";
import { ServicoMonitoramento } from "../../monitoramento/servico-monitoramento";
import { janelaEvento, vincularEventoASegmentos } from "../../domain/vinculo-evento-video";
import { filtrarEventosTemporais } from "../../domain";
import { EventoTemporalComVideo } from "../../types";
import { BODY_MAX_BYTES, readBody, registrarFalha, sendJson } from "../base";
import {
  appendCiclo,
  appendEventoTemporal,
  lerCiclos,
  lerEventosTemporais,
  limparCiclosPersistidos,
  limparEventosTemporais,
  montarEventoTemporal,
  montarRegistroCiclo,
} from "../persistencia";
import { auditarNulo, type RegistradorAuditoria } from "../auditoria";
import { parsearFiltrosEventosTemporais } from "./filtros";

/**
 * `POST /api/ciclos` — grava o diagnostico de um ciclo (metricas por etapa,
 * erros, subsistemas indisponiveis e relacoes sessao/ciclo/frames). Um ciclo
 * incompleto continua registravel: o erro fica no proprio registro.
 */
export async function handleCiclos(
  req: IncomingMessage,
  res: ServerResponse,
  ciclosFile: string
): Promise<void> {
  try {
    const raw = await readBody(req, BODY_MAX_BYTES);
    const payload: unknown = JSON.parse(raw || "{}");
    const registro = montarRegistroCiclo(payload);
    if (!registro) {
      sendJson(res, 400, { ok: false, erro: "campos 'sessionId' e 'cycleId' obrigatorios" });
      return;
    }
    await appendCiclo(registro, ciclosFile);
    sendJson(res, 200, { ok: true, ciclo: registro });
  } catch (err) {
    sendJson(res, 400, { ok: false, erro: (err as Error).message });
  }
}

/** `GET /api/ciclos` — lista os diagnosticos de ciclo mais recentes. */
export async function handleListCiclos(
  req: IncomingMessage,
  res: ServerResponse,
  ciclosFile: string
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/api/ciclos", "http://localhost");
    const limitParam = Number(url.searchParams.get("limit"));
    const limite = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 500) : 50;
    const ciclos = await lerCiclos(ciclosFile, limite);
    sendJson(res, 200, { ok: true, total: ciclos.length, ciclos });
  } catch (err) {
    registrarFalha("error", "listar_ciclos_falhou", { erro: (err as Error).message });
    sendJson(res, 500, { ok: false, erro: (err as Error).message });
  }
}

/** `DELETE /api/ciclos` — esvazia os diagnosticos de ciclo persistidos. */
export async function handleClearCiclos(res: ServerResponse, ciclosFile: string): Promise<void> {
  try {
    await limparCiclosPersistidos(ciclosFile);
    sendJson(res, 200, { ok: true });
  } catch (err) {
    registrarFalha("error", "limpar_ciclos_falhou", { erro: (err as Error).message });
    sendJson(res, 500, { ok: false, erro: (err as Error).message });
  }
}

/**
 * `POST /api/eventos-temporais` — grava uma atualizacao de gesto/postura/
 * movimento corporal. Stream separado de `eventos.jsonl` (P2.6).
 */
export async function handleEventosTemporais(
  req: IncomingMessage,
  res: ServerResponse,
  eventosTemporaisFile: string
): Promise<void> {
  try {
    const raw = await readBody(req, BODY_MAX_BYTES);
    const payload: unknown = JSON.parse(raw || "{}");
    const evento = montarEventoTemporal(payload);
    if (!evento) {
      sendJson(res, 400, {
        ok: false,
        erro:
          "evento temporal invalido: exige eventoId, sessionId, tipo de gesto/postura, " +
          "inicioEm, descricao, estado (confirmado/encerrado/incerto) e idempotencyKey",
      });
      return;
    }
    // A fila do cliente pode reenviar apos falha transitoria: a chave estavel
    // evita duplicar a mesma atualizacao no stream append-only.
    if (eventoJaRegistrado(eventosTemporaisFile, evento.idempotencyKey)) {
      sendJson(res, 200, { ok: true, evento, duplicado: true });
      return;
    }
    await appendEventoTemporal(evento, eventosTemporaisFile);
    marcarEventoRegistrado(eventosTemporaisFile, evento.idempotencyKey);
    sendJson(res, 200, { ok: true, evento });
  } catch (err) {
    sendJson(res, 400, { ok: false, erro: (err as Error).message });
  }
}

/** `GET /api/eventos-temporais` — consulta a linha do tempo e seus videos. */
export async function handleListEventosTemporais(
  req: IncomingMessage,
  res: ServerResponse,
  eventosTemporaisFile: string,
  monitoramento: ServicoMonitoramento
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/api/eventos-temporais", "http://localhost");
    const limitParam = Number(url.searchParams.get("limit"));
    const limite =
      Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 500) : 100;
    const filtros = parsearFiltrosEventosTemporais(url);
    const segmentoId = url.searchParams.get("segmentoId")?.trim() || undefined;

    const filtrados = filtrarEventosTemporais(
      await lerEventosTemporais(eventosTemporaisFile, limite),
      filtros
    );

    // Resolve o indice uma unica vez para toda a pagina, usando a janela dos
    // proprios eventos. Segmentos gravados depois do evento passam a aparecer:
    // o vinculo e derivado na leitura, nunca congelado no registro.
    let inicioJanela = Number.POSITIVE_INFINITY;
    let fimJanela = Number.NEGATIVE_INFINITY;
    for (const evt of filtrados) {
      const janela = janelaEvento(evt.inicioEm, evt.fimEm);
      if (!janela) continue;
      inicioJanela = Math.min(inicioJanela, janela.inicioMs);
      fimJanela = Math.max(fimJanela, janela.fimMs);
    }
    const segmentos = Number.isFinite(inicioJanela)
      ? await monitoramento.segmentosParaIntervalo(inicioJanela, fimJanela, 5000)
      : [];

    const eventos: EventoTemporalComVideo[] = filtrados.map((evt) => ({
      ...evt,
      segmentos: vincularEventoASegmentos(evt.inicioEm, evt.fimEm, segmentos).map((ref) => ({
        ...ref,
        url: `/api/monitoramento/videos/${encodeURIComponent(ref.segmentoId)}`,
      })),
    }));
    const visiveis = segmentoId
      ? eventos.filter((evt) => evt.segmentos.some((ref) => ref.segmentoId === segmentoId))
      : eventos;

    sendJson(res, 200, { ok: true, total: visiveis.length, eventos: visiveis });
  } catch (err) {
    registrarFalha("error", "listar_eventos_temporais_falhou", { erro: (err as Error).message });
    sendJson(res, 500, { ok: false, erro: (err as Error).message });
  }
}

/** `DELETE /api/eventos-temporais` — esvazia a memoria de gestos/posturas. */
export async function handleClearEventosTemporais(
  res: ServerResponse,
  eventosTemporaisFile: string,
  auditar: RegistradorAuditoria = auditarNulo
): Promise<void> {
  try {
    await limparEventosTemporais(eventosTemporaisFile);
    auditar({ acao: "limpeza_eventos_temporais", resultado: "sucesso", alvo: "eventos-temporais" });
    sendJson(res, 200, { ok: true });
  } catch (err) {
    auditar({ acao: "limpeza_eventos_temporais", resultado: "falha", alvo: "eventos-temporais" });
    registrarFalha("error", "limpar_eventos_temporais_falhou", { erro: (err as Error).message });
    sendJson(res, 500, { ok: false, erro: (err as Error).message });
  }
}
