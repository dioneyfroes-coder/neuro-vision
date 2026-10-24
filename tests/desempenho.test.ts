import { afterEach, describe, expect, it, vi } from "vitest";
import {
  nucleosLogicos,
  THREADS_WASM_POR_WORKER,
  threadsWasm,
  webgpuDisponivel,
} from "../public/desempenho";

/**
 * Decisoes de desempenho para o hardware-alvo (20 nucleos logicos, 16 GB,
 * GPU de 6 GB). Sao puras e dependem de globais do navegador; aqui fixamos
 * `navigator`/`crossOriginIsolated` para cobrir os ramos.
 */

function stubNavegador(opcoes: {
  nucleos?: number;
  gpu?: boolean;
  webdriver?: boolean;
}): void {
  vi.stubGlobal("navigator", {
    hardwareConcurrency: opcoes.nucleos,
    gpu: opcoes.gpu ? {} : undefined,
    webdriver: opcoes.webdriver ?? false,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("nucleosLogicos", () => {
  it("usa hardwareConcurrency quando valido", () => {
    stubNavegador({ nucleos: 20 });
    expect(nucleosLogicos()).toBe(20);
  });

  it("cai para 1 quando o navegador nao informa", () => {
    stubNavegador({ nucleos: 0 });
    expect(nucleosLogicos()).toBe(1);
  });
});

describe("threadsWasm", () => {
  it("fica em 1 sem isolamento entre origens", () => {
    stubNavegador({ nucleos: 20 });
    vi.stubGlobal("crossOriginIsolated", false);
    expect(threadsWasm()).toBe(1);
  });

  it("usa ate 4 threads com isolamento", () => {
    stubNavegador({ nucleos: 20 });
    vi.stubGlobal("crossOriginIsolated", true);
    expect(threadsWasm()).toBe(THREADS_WASM_POR_WORKER);
  });

  it("nao pede mais threads do que nucleos logicos", () => {
    stubNavegador({ nucleos: 2 });
    vi.stubGlobal("crossOriginIsolated", true);
    expect(threadsWasm()).toBe(2);
  });
});

describe("webgpuDisponivel", () => {
  it("exige navigator.gpu", () => {
    stubNavegador({ nucleos: 20, gpu: false });
    expect(webgpuDisponivel()).toBe(false);
  });

  it("usa GPU no navegador normal", () => {
    stubNavegador({ nucleos: 20, gpu: true });
    expect(webgpuDisponivel()).toBe(true);
  });

  it("prefere WASM sob automacao (Playwright/CI)", () => {
    stubNavegador({ nucleos: 20, gpu: true, webdriver: true });
    expect(webgpuDisponivel()).toBe(false);
  });
});
