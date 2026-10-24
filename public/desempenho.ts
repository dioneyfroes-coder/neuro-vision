/**
 * Ajustes de desempenho para o hardware de execucao.
 *
 * O alvo deste projeto e uma maquina de trabalho (20 nucleos logicos, 16 GB de
 * RAM, GPU de 6 GB): as decisoes abaixo sao deliberadamente empiricas e valem
 * para esse perfil, nao como promessa de portabilidade.
 *
 * - **WASM multithread** so funciona com `crossOriginIsolated` (headers COOP/COEP
 *   em `src/server.ts`). Sem isolamento o runtime cai para 1 thread de qualquer
 *   forma, entao devolvemos 1 e evitamos o aviso do ONNX Runtime.
 * - **WebGPU** e usado quando existe e a automacao nao esta no comando. O
 *   Playwright/CI expoe `navigator.webdriver` e, em headless, o adaptador pode
 *   ser SwiftShader (lento e instavel); nesse caso ficamos no WASM. No navegador
 *   normal da maquina do usuario a GPU entra em deteccao/pose.
 */

/** Nucleos logicos expostos ao navegador (fallback: 1). */
export function nucleosLogicos(): number {
  if (typeof navigator === "undefined") return 1;
  const nucleos = navigator.hardwareConcurrency;
  return Number.isFinite(nucleos) && nucleos > 0 ? nucleos : 1;
}

/**
 * Threads do WASM por worker. Limitado a 4: os subsistemas rodam em workers
 * separados e, com 3-4 runtimes ativos, mais threads por runtime so geraria
 * disputa pelos 20 nucleos logicos.
 */
export const THREADS_WASM_POR_WORKER = 4;

/** `true` quando o documento esta isolado (SharedArrayBuffer disponivel). */
export function isoladoEntreOrigens(): boolean {
  return typeof crossOriginIsolated !== "undefined" && crossOriginIsolated;
}

/** Threads efetivas do WASM: 1 sem isolamento, senao ate 4. */
export function threadsWasm(): number {
  if (!isoladoEntreOrigens()) return 1;
  return Math.max(1, Math.min(THREADS_WASM_POR_WORKER, nucleosLogicos()));
}

/**
 * `true` quando vale tentar WebGPU. Fora do navegador, ou sob automacao
 * (`navigator.webdriver`), devolve `false` - o fallback WASM e previsivel.
 */
export function webgpuDisponivel(): boolean {
  if (typeof navigator === "undefined") return false;
  const navegador = navigator as Navigator & { gpu?: unknown; webdriver?: boolean };
  if (navegador.webdriver) return false;
  return navegador.gpu !== undefined && navegador.gpu !== null;
}
