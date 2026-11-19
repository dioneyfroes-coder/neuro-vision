/**
 * Rotas de observacoes, eventos, eventos temporais, ciclos e operacional.
 *
 * Extraido de `src/server.ts` na refatoracao de responsabilidades.
 */
import { IncomingMessage } from "node:http";
import { ServerResponse } from "node:http";
import { filtrarEventos } from "../memoria";
import { montarEvento } from "../memoria";
import { montarOperacional } from "../memoria";
import { reidratarContexto } from "../memoria";
import { eventoJaRegistrado } from "../persistence/repositorio-eventos";
import { marcarEventoRegistrado } from "../persistence/repositorio-eventos";
import { ServicoMonitoramento } from "../monitoramento/servico-monitoramento";
import { JANELA_EVIDENCIA_ANTES_MS } from "../domain/vinculo-evento-video";
import { JANELA_EVIDENCIA_DEPOIS_MS } from "../domain/vinculo-evento-video";
import { janelaEvento } from "../domain/vinculo-evento-video";
import { vincularEventoASegmentos } from "../domain/vinculo-evento-video";
import { vincularInstanteAosSegmentos } from "../domain/vinculo-evento-video";
import { EntradaLogComVideo } from "../types";
import { EventoTemporalComVideo } from "../types";
import { EventoVisualComVideo } from "../types";
import { ReferenciaVideoEventoApi } from "../types";
import { EstadoEventoTemporal } from "../domain/temporal-event";
import { TipoEventoTemporal } from "../domain/temporal-event";

import { BODY_MAX_BYTES, arquivosDeMemoria, readBody, registrarFalha, sendJson } from "./base";
import { ESTADOS_EVENTO_TEMPORAL_PERSISTIDOS, TIPOS_EVENTO_TEMPORAL_PERSISTIDOS, agendarLimpezaSnapshots, appendCiclo, appendEvento, appendEventoTemporal, appendLogEntry, appendOperacional, lerCiclos, lerEventos, lerEventosTemporais, lerLogEntries, limparCiclosPersistidos, limparEventos, limparEventosTemporais, limparLog, limparSnapshots, montarEventoTemporal, montarRegistroCiclo, salvarSnapshot, validarPayloadLog } from "./persistencia";
import { inteiroLimitado, montarEntrada, parsearInstante, parsearTiposEvento, validarPayloadEvento } from "./validacao";

export async function handleLog(
  req: IncomingMessage,
  res: ServerResponse,
  logFile: string,
  snapDir: string,
  eventosFile: string
): Promise<void> {
  try {
    const raw = await readBody(req, BODY_MAX_BYTES);
    const payload: unknown = JSON.parse(raw || "{}");
    const erro = validarPayloadLog(payload);
    if (erro) {
      sendJson(res, 400, { ok: false, erro });
      return;
    }
    const entry = montarEntrada(payload);
    const p = (typeof payload === "object" && payload !== null ? payload : {}) as Record<
      string,
      unknown
    >;
    const snapshot = await salvarSnapshot(p.snapshot, snapDir);
    if (snapshot) entry.snapshot = snapshot;
    await appendLogEntry(entry, logFile);
    if (snapshot) agendarLimpezaSnapshots(snapDir, logFile, eventosFile);
    sendJson(res, 200, { ok: true, entrada: entry });
  } catch (err) {
    sendJson(res, 400, { ok: false, erro: (err as Error).message });
  }
}

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
 * Anexa a cada registro da pagina os trechos de video que cobrem seu instante.
 * O indice e consultado uma unica vez com a janela da pagina; o vinculo e
 * derivado na leitura, entao segmentos gravados depois passam a aparecer.
 */
export async function anexarTrechosDeVideo<T extends object>(
  registros: readonly T[],
  instante: (registro: T) => string | undefined,
  monitoramento: ServicoMonitoramento
): Promise<Array<T & { segmentos: ReferenciaVideoEventoApi[] }>> {
  if (registros.length === 0) return [];
  const instantes = registros.map((registro) => parsearInstante(instante(registro) ?? null));
  let inicioJanela = Number.POSITIVE_INFINITY;
  let fimJanela = Number.NEGATIVE_INFINITY;
  for (const ms of instantes) {
    if (ms === undefined) continue;
    inicioJanela = Math.min(inicioJanela, ms - JANELA_EVIDENCIA_ANTES_MS);
    fimJanela = Math.max(fimJanela, ms + JANELA_EVIDENCIA_DEPOIS_MS);
  }
  const segmentos = Number.isFinite(inicioJanela)
    ? await monitoramento.segmentosParaIntervalo(inicioJanela, fimJanela, 5000)
    : [];

  return registros.map((registro, i) => {
    const ms = instantes[i];
    return {
      ...registro,
      segmentos:
        ms === undefined
          ? []
          : vincularInstanteAosSegmentos(ms, segmentos).map((ref) => ({
              ...ref,
              url: `/api/monitoramento/videos/${encodeURIComponent(ref.segmentoId)}`,
            })),
    };
  });
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
    const entradas = await lerLogEntries(logFile, maxEntradas);
    const eventos = await lerEventos(eventosFile, maxEventos);
    const contexto = reidratarContexto(entradas, eventos, {
      maxEntradas,
      maxEventos,
      maxCaracteres,
    });
    sendJson(res, 200, { ok: true, ...contexto });
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

export async function handleListLogs(
  req: IncomingMessage,
  res: ServerResponse,
  logFile: string,
  monitoramento: ServicoMonitoramento
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/api/logs", "http://localhost");
    const limitParam = Number(url.searchParams.get("limit"));
    const limite = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 500) : 100;
    const entradas: EntradaLogComVideo[] = await anexarTrechosDeVideo(
      await lerLogEntries(logFile, limite),
      (entrada) => entrada.capturadoEm ?? entrada.timestamp,
      monitoramento
    );
    sendJson(res, 200, { ok: true, total: entradas.length, entradas });
  } catch (err) {
    registrarFalha("error", "listar_logs_falhou", { erro: (err as Error).message });
    sendJson(res, 500, { ok: false, erro: (err as Error).message });
  }
}

export async function handleClearLogs(
  res: ServerResponse,
  logFile: string,
  snapDir: string,
  eventosFile: string,
  ciclosFile: string,
  eventosTemporaisFile: string
): Promise<void> {
  try {
    // "Limpar historico" apaga os dados persistidos: observacoes, eventos
    // visuais, memoria de gestos/posturas, diagnosticos de ciclo e os snapshots
    // que ficaram orfaos. Nao mexe no estado temporal em memoria do cliente —
    // esse reset e uma acao separada.
    await limparLog(logFile);
    await limparEventos(eventosFile);
    await limparEventosTemporais(eventosTemporaisFile);
    await limparCiclosPersistidos(ciclosFile);
    // Sem historico nem eventos, todos os snapshots ficam orfaos: a limpeza os
    // remove de imediato, mantendo o uso de disco limitado pela politica.
    const snapshots = await limparSnapshots({
      snapDir,
      logFiles: arquivosDeMemoria(logFile, eventosFile),
    });
    sendJson(res, 200, { ok: true, snapshots });
  } catch (err) {
    registrarFalha("error", "limpar_logs_falhou", { erro: (err as Error).message });
    sendJson(res, 500, { ok: false, erro: (err as Error).message });
  }
}
