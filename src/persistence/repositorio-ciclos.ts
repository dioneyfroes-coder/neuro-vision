/**
 * Repositorio de ciclos (Etapa 8 do roteiro).
 *
 * Grava `RegistroCiclo` — metricas por etapa, subsistemas indisponiveis, erros
 * parciais e as relacoes `sessionId`/`cycleId`/`frameIds`. E o que permite
 * diagnosticar um ciclo incompleto depois que ele passou: um ciclo que falhou
 * na deteccao ou no multimodal continua legivel, com o motivo registrado, em
 * vez de desaparecer silenciosamente.
 */
import { appendJsonl, lerUltimosJsonl, limparJsonl } from "./armazenamento-jsonl";
import type { RegistroCiclo } from "../domain/cycle";

/** Acrescenta o registro de um ciclo (append-only, com rotacao). */
export async function gravarCiclo(
  registro: RegistroCiclo,
  filePath: string,
  maxBytes: number
): Promise<void> {
  await appendJsonl(registro, filePath, maxBytes);
}

/** Le os registros de ciclo mais recentes (mais recente primeiro). */
export async function lerCiclos(filePath: string, limit: number): Promise<RegistroCiclo[]> {
  return lerUltimosJsonl<RegistroCiclo>(filePath, limit);
}

/** Esvazia os registros de ciclo. */
export async function limparCiclos(filePath: string): Promise<void> {
  await limparJsonl(filePath);
}
