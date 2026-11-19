/** Formata bytes em MB com uma casa; `n/d` quando a metrica nao existe. */
export function formatarBytes(bytes) {
  if (!Number.isFinite(bytes)) return "n/d";
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Valor efetivo de uma amostra, preferindo o total do agente ao WASM/heap JS. */
export function memoriaDaAmostra(amostra) {
  if (!amostra) return null;
  if (Number.isFinite(amostra.totalBytes)) return amostra.totalBytes;
  if (Number.isFinite(amostra.wasmBytes) && amostra.wasmBytes > 0) return amostra.wasmBytes;
  if (Number.isFinite(amostra.jsHeapBytes)) return amostra.jsHeapBytes;
  return null;
}