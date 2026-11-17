/**
 * Índice durável da referência do ambiente e das mudanças observadas (Fase 3).
 *
 * JSONL append-only: cada redefinição de referência e cada mudança acrescenta
 * uma linha. A leitura mantém a versão mais recente da referência por sessão e
 * deduplica mudanças por `mudancaId`, para que comparar o mesmo quadro duas
 * vezes não duplique a linha do tempo.
 */
import { appendJsonl, lerUltimosJsonl } from "./armazenamento-jsonl";
import type { MudancaCena, ReferenciaCena } from "../domain";

export function gravarReferenciaCena(
  referencia: ReferenciaCena,
  filePath: string,
  maxBytes: number
): Promise<void> {
  return appendJsonl(referencia, filePath, maxBytes);
}

export async function lerReferenciaCena(
  sessaoId: string,
  filePath: string,
  limit: number
): Promise<ReferenciaCena | null> {
  const registros = await lerUltimosJsonl<ReferenciaCena>(filePath, limit);
  for (const referencia of registros) {
    if (referencia?.sessaoId === sessaoId) return referencia;
  }
  return null;
}

export function gravarMudancaCena(
  mudanca: MudancaCena,
  filePath: string,
  maxBytes: number
): Promise<void> {
  return appendJsonl(mudanca, filePath, maxBytes);
}

/** Mudanças de uma sessão em ordem cronológica, sem duplicatas por `mudancaId`. */
export async function lerMudancasCena(
  sessaoId: string,
  filePath: string,
  limit: number
): Promise<MudancaCena[]> {
  const registros = await lerUltimosJsonl<MudancaCena>(filePath, limit);
  const vistas = new Set<string>();
  const mudancas: MudancaCena[] = [];
  for (const mudanca of registros) {
    if (!mudanca?.mudancaId || mudanca.sessaoId !== sessaoId || vistas.has(mudanca.mudancaId)) {
      continue;
    }
    vistas.add(mudanca.mudancaId);
    mudancas.push(mudanca);
  }
  return mudancas.sort(
    (a, b) => a.detectadoEmMs - b.detectadoEmMs || a.mudancaId.localeCompare(b.mudancaId)
  );
}
