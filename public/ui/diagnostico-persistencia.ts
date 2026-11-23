/**
 * Diagnostico da fila de persistencia (Fase 8).
 *
 * Antes essas regras viviam inline em `public/app.ts`, dentro de uma funcao
 * grande de renderizacao. Extrair a transformacao `EstadoFila -> texto` deixa
 * a politica de aviso testavel sem montar a pagina e garante que um descarte
 * por backpressure apareca como perda explicita — nunca como gravacao salva.
 */

import type { EstadoFila } from "../persistencia";

/** Partes do diagnostico derivadas da fila; ausencia nao vira zero inventado. */
export function partesDiagnosticoPersistencia(fila: EstadoFila): string[] {
  const partes: string[] = [];
  if (fila.pendentes > 0) partes.push(`fila ${fila.pendentes}`);
  if (fila.falhas > 0) partes.push(`falhas de persistencia ${fila.falhas}`);
  if (fila.descartes > 0) partes.push(`descartes da fila ${fila.descartes}`);
  return partes;
}

/**
 * Aviso visivel quando alguma gravacao nao chegou ao servidor. `descartes`
 * entra como informacao adicional: esses itens nao podem mais ser exportados,
 * mas o usuario precisa saber que houve perda por limite de capacidade.
 */
export function textoAvisoPersistencia(fila: EstadoFila): string | null {
  if (fila.falhas === 0 && fila.descartes === 0) return null;
  const detalhe = fila.ultimoErro ? ` — ${fila.ultimoErro}` : "";
  const descartes = fila.descartes > 0 ? ` (${fila.descartes} descartado(s) por limite)` : "";
  return `Aviso: ${fila.falhas} gravacao(oes) nao chegaram ao servidor${descartes}${detalhe}. Use "Pendentes" para exportar.`;
}
