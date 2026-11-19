import type { RegistroOperacional } from "../../memoria";
import type { RegistroCiclo } from "../../domain/cycle";
import {
  gravarObservacao,
  lerObservacoes,
  limparObservacoes,
} from "../../persistence/repositorio-observacoes";
import {
  gravarEvento,
  lerEventos as lerEventosRepo,
  limparEventos as limparEventosRepo,
} from "../../persistence/repositorio-eventos";
import {
  gravarEventoTemporal,
  lerEventosTemporais as lerEventosTemporaisRepo,
  limparEventosTemporais as limparEventosTemporaisRepo,
} from "../../persistence/repositorio-eventos-temporais";
import {
  gravarOperacional,
  lerOperacional as lerOperacionalRepo,
} from "../../persistence/repositorio-operacional";
import {
  gravarCiclo,
  lerCiclos as lerCiclosRepo,
  limparCiclos,
} from "../../persistence/repositorio-ciclos";
import type { EntradaLog, EventoTemporalPersistido, EventoVisual } from "../../types";
import {
  CICLOS_FILE,
  EVENTOS_FILE,
  EVENTOS_TEMPORAIS_FILE,
  LOG_FILE,
  LOG_MAX_BYTES,
  OPERACIONAL_FILE,
} from "../base";

export async function appendLogEntry(entry: EntradaLog, filePath: string = LOG_FILE): Promise<void> {
  await gravarObservacao(entry, filePath, LOG_MAX_BYTES);
}

export async function lerLogEntries(
  filePath: string = LOG_FILE,
  limit = 100
): Promise<EntradaLog[]> {
  return lerObservacoes(filePath, limit);
}

export async function limparLog(filePath: string = LOG_FILE): Promise<void> {
  await limparObservacoes(filePath);
}

export async function appendEvento(
  evento: EventoVisual,
  filePath: string = EVENTOS_FILE
): Promise<void> {
  await gravarEvento(evento, filePath, LOG_MAX_BYTES);
}

export async function lerEventos(
  filePath: string = EVENTOS_FILE,
  limit = 100
): Promise<EventoVisual[]> {
  return lerEventosRepo(filePath, limit);
}

export async function limparEventos(filePath: string = EVENTOS_FILE): Promise<void> {
  await limparEventosRepo(filePath);
}

/** Grava uma atualizacao de evento temporal de gesto/postura (P2.6). */
export async function appendEventoTemporal(
  evento: EventoTemporalPersistido,
  filePath: string = EVENTOS_TEMPORAIS_FILE
): Promise<void> {
  await gravarEventoTemporal(evento, filePath, LOG_MAX_BYTES);
}

/** Le as atualizacoes de eventos temporais mais recentes (mais recente primeiro). */
export async function lerEventosTemporais(
  filePath: string = EVENTOS_TEMPORAIS_FILE,
  limit = 100
): Promise<EventoTemporalPersistido[]> {
  return lerEventosTemporaisRepo(filePath, limit);
}

/** Esvazia a memoria de gestos/posturas. */
export async function limparEventosTemporais(
  filePath: string = EVENTOS_TEMPORAIS_FILE
): Promise<void> {
  await limparEventosTemporaisRepo(filePath);
}

export async function appendOperacional(
  registro: RegistroOperacional,
  filePath: string = OPERACIONAL_FILE
): Promise<void> {
  await gravarOperacional(registro, filePath, LOG_MAX_BYTES);
}

export async function lerOperacional(
  filePath: string = OPERACIONAL_FILE,
  limit = 100
): Promise<RegistroOperacional[]> {
  return lerOperacionalRepo(filePath, limit);
}

/** Grava o registro de diagnostico de um ciclo (Etapa 8). */
export async function appendCiclo(
  registro: RegistroCiclo,
  filePath: string = CICLOS_FILE
): Promise<void> {
  await gravarCiclo(registro, filePath, LOG_MAX_BYTES);
}

/** Le os registros de ciclo mais recentes (mais recente primeiro). */
export async function lerCiclos(
  filePath: string = CICLOS_FILE,
  limit = 100
): Promise<RegistroCiclo[]> {
  return lerCiclosRepo(filePath, limit);
}

/** Esvazia os registros de ciclo persistidos. */
export async function limparCiclosPersistidos(filePath: string = CICLOS_FILE): Promise<void> {
  await limparCiclos(filePath);
}
