/**
 * Repositorio de registros operacionais (Etapa 8 do roteiro).
 *
 * Registros operacionais sao falhas e metricas que **nao** sao acontecimentos
 * visuais (ex.: cliente, visao, armazenamento). Ficam em arquivo separado dos
 * eventos para nao confundir "nao vi nada" com "algo falhou".
 */
import { appendJsonl, lerUltimosJsonl } from "./armazenamento-jsonl";

/** Nivel de um registro operacional. */
export type NivelOperacional = "info" | "aviso" | "erro";

/** Registro operacional (falha/metrica de subsistema, nao evento visual). */
export interface RegistroOperacional {
  timestamp: string;
  nivel: NivelOperacional;
  /** Subsistema que originou o registro (ex.: `cliente`, `visao`, `armazenamento`). */
  origem: string;
  mensagem: string;
  detalhe?: string;
}

/** Acrescenta um registro operacional (append-only, com rotacao). */
export async function gravarOperacional(
  registro: RegistroOperacional,
  filePath: string,
  maxBytes: number
): Promise<void> {
  await appendJsonl(registro, filePath, maxBytes);
}

/** Le os registros operacionais mais recentes (mais recente primeiro). */
export async function lerOperacional(
  filePath: string,
  limit: number
): Promise<RegistroOperacional[]> {
  return lerUltimosJsonl<RegistroOperacional>(filePath, limit);
}
