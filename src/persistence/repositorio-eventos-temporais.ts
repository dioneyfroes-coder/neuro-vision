/**
 * Repositorio de eventos temporais de gesto/postura (P2.6).
 *
 * Stream **separado** de `eventos.jsonl`: este guarda a memoria pesquisavel de
 * `gesto_detectado`, `braco_levantado` e `movimento_corporal`, com identidade,
 * inicio, atualizacoes de estado, frames de evidencia e incerteza
 * (`intervaloSemObservacaoMs`). Nao mistura esses sinais com os fatos visuais
 * (`aparicao`/`desaparecimento`/`mudanca_de_cena`) para nao mudar a semantica
 * do stream legado sem contrato de migracao.
 */
import { appendJsonl, lerUltimosJsonl, limparJsonl } from "./armazenamento-jsonl";
import {
  esquecerEventosRegistrados,
  eventoJaRegistrado,
  marcarEventoRegistrado,
} from "./repositorio-eventos";
import type { EventoTemporalPersistido } from "../types";

/** Acrescenta uma atualizacao de evento temporal (append-only, com rotacao). */
export async function gravarEventoTemporal(
  evento: EventoTemporalPersistido,
  filePath: string,
  maxBytes: number
): Promise<void> {
  await appendJsonl(evento, filePath, maxBytes);
}

/** Le as atualizacoes mais recentes (mais recente primeiro). */
export async function lerEventosTemporais(
  filePath: string,
  limit: number
): Promise<EventoTemporalPersistido[]> {
  return lerUltimosJsonl<EventoTemporalPersistido>(filePath, limit);
}

/** Esvazia o stream e invalida as chaves de idempotencia do arquivo. */
export async function limparEventosTemporais(filePath: string): Promise<void> {
  await limparJsonl(filePath);
  esquecerEventosRegistrados(filePath);
}

export { eventoJaRegistrado, marcarEventoRegistrado };
