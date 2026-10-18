/**
 * Repositorio de observacoes (Etapa 8 do roteiro).
 *
 * "Observacao" aqui e a entrada de historico de visao (`EntradaLog`): o que a
 * webcam viu e o modelo descreveu. As imagens em si ficam em snapshots; este
 * repositorio guarda apenas o dado estruturado. Separar a gravacao do servidor
 * HTTP permite trocar a midia de persistencia e testar a leitura/escrita sem
 * subir um servidor.
 */
import { appendJsonl, lerUltimosJsonl, limparJsonl } from "./armazenamento-jsonl";
import type { EntradaLog } from "../types";

/** Acrescenta uma observacao ao historico (append-only, com rotacao). */
export async function gravarObservacao(
  entrada: EntradaLog,
  filePath: string,
  maxBytes: number
): Promise<void> {
  await appendJsonl(entrada, filePath, maxBytes);
}

/** Le as observacoes mais recentes (mais nova primeiro). */
export async function lerObservacoes(filePath: string, limit: number): Promise<EntradaLog[]> {
  return lerUltimosJsonl<EntradaLog>(filePath, limit);
}

/** Esvazia o historico de observacoes. */
export async function limparObservacoes(filePath: string): Promise<void> {
  await limparJsonl(filePath);
}
