import { IncomingMessage } from "node:http";
import { ServerResponse } from "node:http";
import { eventoJaRegistrado } from "../../persistence/repositorio-eventos";
import { marcarEventoRegistrado } from "../../persistence/repositorio-eventos";
import { ServicoMonitoramento } from "../../monitoramento/servico-monitoramento";
import { janelaEvento, vincularEventoASegmentos } from "../../domain/vinculo-evento-video";
import { EventoTemporalComVideo } from "../../types";
import { EstadoEventoTemporal } from "../../domain/temporal-event";
import { TipoEventoTemporal } from "../../domain/temporal-event";
import { BODY_MAX_BYTES, readBody, registrarFalha, sendJson } from "../base";
import {
  ESTADOS_EVENTO_TEMPORAL_PERSISTIDOS,
  TIPOS_EVENTO_TEMPORAL_PERSISTIDOS,
  appendCiclo,
  appendEventoTemporal,
  lerCiclos,
  lerEventosTemporais,
  limparCiclosPersistidos,
  limparEventosTemporais,
  montarEventoTemporal,
  montarRegistroCiclo,
} from "../persistencia";
import { parsearInstante } from "../validacao";

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
    const tipos = new Set(
      (url.searchParams.get("tipo") ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter((t): t is TipoEventoTemporal =>
          TIPOS_EVENTO_TEMPORAL_PERSISTIDOS.includes(t as TipoEventoTemporal)
        )
    );
    const estados = new Set(
      (url.searchParams.get("estado") ?? "")
        .split(",")
        .map((e) => e.trim())
        .filter((e): e is EstadoEventoTemporal =>
          ESTADOS_EVENTO_TEMPORAL_PERSISTIDOS.includes(e as EstadoEventoTemporal)
        )
    );
    const csv = (chave: string) =>
      new Set(
        (url.searchParams.get(chave) ?? "")
          .split(",")
          .map((valor) => valor.trim())
          .filter((valor) => valor.length > 0)
      );
    const entidadeId = url.searchParams.get("entidadeId")?.trim() || undefined;
    const sessionId = url.searchParams.get("sessionId")?.trim() || undefined;
    const objetos = csv("objeto");
    const participantes = csv("participante");
    const segmentoId = url.searchParams.get("segmentoId")?.trim() || undefined;
    const desdeMs = parsearInstante(url.searchParams.get("desde"));
    const ateMs = parsearInstante(url.searchParams.get("ate"));

    const filtrados = (await lerEventosTemporais(eventosTemporaisFile, limite)).filter((evt) => {
      if (tipos.size > 0 && !tipos.has(evt.tipo)) return false;
      if (estados.size > 0 && !estados.has(evt.estado)) return false;
      if (entidadeId && evt.entidadeId !== entidadeId) return false;
      if (sessionId && evt.sessionId !== sessionId) return false;
      if (objetos.size > 0 && (!evt.rotuloObjeto || !objetos.has(evt.rotuloObjeto))) return false;
      if (
        participantes.size > 0 &&
        !(evt.participantes ?? []).some((id) => participantes.has(id))
      ) {
        return false;
      }
      const inicio = Date.parse(evt.inicioEm);
      if (desdeMs !== undefined && Number.isFinite(inicio) && inicio < desdeMs) return false;
      if (ateMs !== undefined && Number.isFinite(inicio) && inicio > ateMs) return false;
      return true;
    });

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
  eventosTemporaisFile: string
): Promise<void> {
  try {
    await limparEventosTemporais(eventosTemporaisFile);
    sendJson(res, 200, { ok: true });
  } catch (err) {
    registrarFalha("error", "limpar_eventos_temporais_falhou", { erro: (err as Error).message });
    sendJson(res, 500, { ok: false, erro: (err as Error).message });
  }
}
