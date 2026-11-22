/**
 * Repositório append-only da trilha de auditoria (Fase 7).
 *
 * Usa a mesma primitiva JSONL com rotação dos demais repositórios. A leitura é
 * diagnóstica: nunca altera registros nem remove a trilha quando o histórico de
 * eventos é limpo pela interface.
 */
import { appendJsonl, lerUltimosJsonl } from "./armazenamento-jsonl";
import type { RegistroAuditoria } from "../domain/auditoria";

export async function gravarAuditoria(
  registro: RegistroAuditoria,
  filePath: string,
  maxBytes: number
): Promise<void> {
  await appendJsonl(registro, filePath, maxBytes);
}

export async function lerAuditoria(filePath: string, limit: number): Promise<RegistroAuditoria[]> {
  return lerUltimosJsonl<RegistroAuditoria>(filePath, limit);
}
