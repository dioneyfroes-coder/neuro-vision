import { afterEach, beforeEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { limparCacheModelo } from "../../src/visao";

/** Diretorio temporario reiniciado a cada teste (binding vivo via ESM). */
export let tmpDir: string;

/** Fetch original capturado antes de qualquer stub. */
export const realFetch = globalThis.fetch;

/** Registra o ciclo de vida compartilhado pelas fatias de tests/server.test.ts. */
export function registrarAmbienteTeste(): void {
  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "neuro-vision-"));
    limparCacheModelo();
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(tmpDir, { recursive: true, force: true });
  });
}
