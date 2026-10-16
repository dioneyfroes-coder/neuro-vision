/**
 * Identificadores de dominio.
 *
 * Regra (roteiro 4.1): toda entidade carrega os ids necessarios para rastrear
 * sua origem. Um UUID por sessao combinado com contadores locais e suficiente —
 * contadores puros reiniciados a cada execucao colidem com registros historicos.
 */

/** UUID aleatorio com fallback para ambientes sem `crypto.randomUUID`. */
export function uuid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

/** Identificador curto e unico de sessao de execucao. */
export function criarSessionId(): string {
  return uuid().slice(0, 8);
}

/** Identificador de ciclo dentro de uma sessao (unico mesmo entre sessoes). */
export function criarCycleId(sessionId: string, sequencia: number): string {
  return `${sessionId}-c${sequencia}`;
}

/** Identificador de frame dentro de um ciclo. */
export function criarFrameId(cycleId: string, indice: number): string {
  return `${cycleId}-f${indice}`;
}

/**
 * Identificador globalmente unico de evento, para persistencia e referencias.
 * Uso pelo produtor com seu proprio contador: `criarEventoId(sessao, "evt", 1)`.
 */
export function criarEventoId(sessionId: string, prefixo: string, sequencia: number): string {
  return `${prefixo}-${sessionId}-${sequencia}`;
}
