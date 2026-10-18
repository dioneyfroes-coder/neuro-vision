/**
 * Repositorio de eventos estruturados (Etapa 8 do roteiro).
 *
 * Grava `EventoVisual` (aparicao, desaparecimento, movimento, mudanca de cena,
 * resumo) em JSONL. Alem do CRUD, mantem o controle de **idempotencia**: a fila
 * de persistencia do cliente pode reenviar a mesma requisicao apos uma falha
 * transitoria de rede, e o reenvio nao pode duplicar o evento.
 */
import { appendJsonl, lerUltimosJsonl, limparJsonl } from "./armazenamento-jsonl";
import type { EventoVisual } from "../types";

/** Acrescenta um evento estruturado (append-only, com rotacao). */
export async function gravarEvento(
  evento: EventoVisual,
  filePath: string,
  maxBytes: number
): Promise<void> {
  await appendJsonl(evento, filePath, maxBytes);
}

/** Le os eventos mais recentes (mais recente primeiro). */
export async function lerEventos(filePath: string, limit: number): Promise<EventoVisual[]> {
  return lerUltimosJsonl<EventoVisual>(filePath, limit);
}

/** Esvazia os eventos e invalida as chaves de idempotencia do arquivo. */
export async function limparEventos(filePath: string): Promise<void> {
  await limparJsonl(filePath);
  // Arquivo zerado: as chaves de idempotencia antigas deixam de valer.
  eventosIdempotentes.delete(filePath);
}

/**
 * Chaves de idempotencia ja registradas, por arquivo de eventos (Fase 6C).
 * Limitado por `IDEMPOTENTES_MAX`; a ordem de insercao e a de chegada, entao as
 * chaves mais antigas saem primeiro.
 */
const eventosIdempotentes = new Map<string, Set<string>>();
const IDEMPOTENTES_MAX = 2000;

/** Indica se a chave de idempotencia ja foi processada para este arquivo. */
export function eventoJaRegistrado(filePath: string, chave: string): boolean {
  return eventosIdempotentes.get(filePath)?.has(chave) ?? false;
}

/** Marca a chave como processada, descartando as mais antigas no limite. */
export function marcarEventoRegistrado(filePath: string, chave: string): void {
  let chaves = eventosIdempotentes.get(filePath);
  if (!chaves) {
    chaves = new Set();
    eventosIdempotentes.set(filePath, chaves);
  }
  chaves.add(chave);
  while (chaves.size > IDEMPOTENTES_MAX) {
    const primeira = chaves.values().next().value;
    if (primeira === undefined) break;
    chaves.delete(primeira);
  }
}
