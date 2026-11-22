import type { RegistroCiclo } from "../../domain/cycle";
import { statusEvidenciaEvento } from "../../domain/evidencia";
import type {
  EstadoEventoTemporal,
  MotivoEncerramentoEvento,
  OrigemSinalTemporal,
  TipoEventoTemporal,
} from "../../domain/temporal-event";
import type { EventoTemporalPersistido } from "../../types";
import {
  ESTADOS_EVENTO_TEMPORAL_PERSISTIDOS,
  MOTIVOS_ENCERRAMENTO_TEMPORAL,
  ORIGENS_SINAL_TEMPORAL,
  SUBSISTEMAS_VALIDOS,
  TIPOS_EVENTO_TEMPORAL_PERSISTIDOS,
  type SubsistemaIndisponivel,
} from "./tipos";

function numeroFinito(valor: unknown): number | undefined {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : undefined;
}

/**
 * Normaliza o corpo de `POST /api/ciclos` em um `RegistroCiclo`. O registro
 * chega pronto do cliente (derivado com `criarRegistroCiclo`); aqui apenas
 * garantimos os campos essenciais e descartamos o que vier com tipo errado.
 */
export function montarRegistroCiclo(payload: unknown): RegistroCiclo | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.sessionId !== "string" || !p.sessionId) return null;
  if (typeof p.cycleId !== "string" || !p.cycleId) return null;
  const frameIds = Array.isArray(p.frameIds)
    ? p.frameIds.filter((id): id is string => typeof id === "string")
    : [];
  const erros = Array.isArray(p.erros) ? (p.erros as RegistroCiclo["erros"]) : [];
  const subsistemas = Array.isArray(p.subsistemasIndisponiveis)
    ? p.subsistemasIndisponiveis.filter((s): s is SubsistemaIndisponivel =>
        SUBSISTEMAS_VALIDOS.includes(s as SubsistemaIndisponivel)
      )
    : [];
  const metricas =
    typeof p.metricas === "object" && p.metricas !== null
      ? (p.metricas as RegistroCiclo["metricas"])
      : {};
  const politica =
    typeof p.politica === "object" && p.politica !== null
      ? (p.politica as RegistroCiclo["politica"])
      : undefined;
  const configuracao =
    typeof p.configuracao === "object" && p.configuracao !== null
      ? (p.configuracao as RegistroCiclo["configuracao"])
      : undefined;
  return {
    sessionId: p.sessionId,
    cycleId: p.cycleId,
    iniciadoEm: typeof p.iniciadoEm === "string" ? p.iniciadoEm : new Date().toISOString(),
    concluidoEm: typeof p.concluidoEm === "string" ? p.concluidoEm : undefined,
    frameIds,
    observacoes: typeof p.observacoes === "number" ? p.observacoes : frameIds.length,
    eventosTemporais: typeof p.eventosTemporais === "number" ? p.eventosTemporais : 0,
    subsistemasIndisponiveis: subsistemas,
    erros,
    metricas,
    interpretacao: typeof p.interpretacao === "string" ? p.interpretacao : undefined,
    politica,
    configuracao,
    cancelado: p.cancelado === true,
    registroEm: typeof p.registroEm === "string" ? p.registroEm : new Date().toISOString(),
  };
}

/**
 * Normaliza o corpo de `POST /api/eventos-temporais` em um registro
 * persistivel. So aceita os tipos de gesto/postura/movimento corporal e os
 * estados finais/incertos; `candidato` nunca vira memoria.
 */
export function montarEventoTemporal(payload: unknown): EventoTemporalPersistido | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.eventoId !== "string" || !p.eventoId) return null;
  if (typeof p.sessionId !== "string" || !p.sessionId) return null;
  if (!TIPOS_EVENTO_TEMPORAL_PERSISTIDOS.includes(p.tipo as TipoEventoTemporal)) return null;
  if (typeof p.inicioEm !== "string" || !p.inicioEm) return null;
  if (typeof p.descricao !== "string" || !p.descricao) return null;
  if (!ESTADOS_EVENTO_TEMPORAL_PERSISTIDOS.includes(p.estado as EstadoEventoTemporal)) {
    return null;
  }
  if (typeof p.idempotencyKey !== "string" || !p.idempotencyKey) return null;

  const frameIds = Array.isArray(p.frameIds)
    ? p.frameIds.filter((id): id is string => typeof id === "string")
    : [];
  const origens = Array.isArray(p.origens)
    ? p.origens.filter((origem): origem is OrigemSinalTemporal =>
        ORIGENS_SINAL_TEMPORAL.includes(origem as OrigemSinalTemporal)
      )
    : [];
  const confianca =
    typeof p.confianca === "number" && Number.isFinite(p.confianca) ? p.confianca : undefined;
  const intervalo =
    typeof p.intervaloSemObservacaoMs === "number" &&
    Number.isFinite(p.intervaloSemObservacaoMs)
      ? p.intervaloSemObservacaoMs
      : undefined;
  const motivoEncerramento = MOTIVOS_ENCERRAMENTO_TEMPORAL.includes(
    p.motivoEncerramento as MotivoEncerramentoEvento
  )
    ? (p.motivoEncerramento as MotivoEncerramentoEvento)
    : undefined;
  const continuidadeValida =
    typeof p.continuidadeValida === "boolean" ? p.continuidadeValida : undefined;
  const evidencias = Array.isArray(p.evidencias)
    ? p.evidencias.filter((e): e is string => typeof e === "string")
    : undefined;
  const participantes = Array.isArray(p.participantes)
    ? p.participantes.filter((id): id is string => typeof id === "string" && id.length > 0)
    : undefined;
  const tipo = p.tipo as TipoEventoTemporal;
  const estado = p.estado as EstadoEventoTemporal;
  // O status é derivado no servidor a partir dos sinais brutos: um valor
  // enviado pelo cliente nunca pode transformar falha em desaparecimento.
  const statusEvidencia = statusEvidenciaEvento({
    estado,
    tipo,
    motivoEncerramento,
    origens,
    frameIds,
    evidencias,
    intervaloSemObservacaoMs: intervalo,
  });
  // O servidor é a fonte autoritativa do instante de persistência; um valor
  // enviado pelo cliente nunca substitui a chegada real.
  const persistidoEmMs = Date.now();

  return {
    eventoId: p.eventoId,
    sessionId: p.sessionId,
    cycleId: typeof p.cycleId === "string" ? p.cycleId : undefined,
    tipo,
    inicioEm: p.inicioEm,
    fimEm: typeof p.fimEm === "string" ? p.fimEm : undefined,
    ultimaEvidenciaEm:
      typeof p.ultimaEvidenciaEm === "string" ? p.ultimaEvidenciaEm : undefined,
    ultimaObservacaoEm:
      typeof p.ultimaObservacaoEm === "string" ? p.ultimaObservacaoEm : undefined,
    entidadeId: typeof p.entidadeId === "string" ? p.entidadeId : undefined,
    participantes,
    rotuloObjeto: typeof p.rotuloObjeto === "string" ? p.rotuloObjeto : undefined,
    descricao: p.descricao,
    confianca,
    origens,
    frameIds,
    estado,
    intervaloSemObservacaoMs: intervalo,
    motivoEncerramento,
    continuidadeValida,
    evidencias,
    statusEvidencia,
    capturadoEmMs: numeroFinito(p.capturadoEmMs),
    processadoEmMs: numeroFinito(p.processadoEmMs),
    inferidoEmMs: numeroFinito(p.inferidoEmMs),
    persistidoEmMs,
    registradoEmMs: persistidoEmMs,
    desvioRelogioMs: numeroFinito(p.desvioRelogioMs),
    ordemChegada: numeroFinito(p.ordemChegada),
    idempotencyKey: p.idempotencyKey,
    registradoEm:
      typeof p.registradoEm === "string" ? p.registradoEm : new Date(persistidoEmMs).toISOString(),
  };
}
