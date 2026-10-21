import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BASE_MEDIAPIPE_CDN,
  BASE_MODELOS_LOCAL,
  BASE_ONNXRUNTIME_CDN,
  BASE_TRANSFORMERS_CDN,
  BASE_VENDOR_LOCAL,
  baseModelosLocal,
  caminhosMediaPipe,
  caminhosOnnxRuntime,
  limparCacheOffline,
  modelosDisponivel,
  moduloTransformers,
  vendorDisponivel,
} from "../public/offline";

/**
 * `public/offline.ts` decide entre caminhos locais (`/vendor/`, `/modelos/`) e
 * o CDN, com um `HEAD` unico por area. Os testes controlam `fetch` para simular
 * as duas situacoes; `limparCacheOffline` zera o cache entre casos.
 */

afterEach(() => {
  vi.unstubAllGlobals();
  limparCacheOffline();
});

function fetchComLocais(locais: Record<string, boolean>) {
  return vi.fn(async (url: string | URL, init?: RequestInit) => {
    const href = typeof url === "string" ? url : url.href;
    if (init?.method === "HEAD") {
      const base = Object.keys(locais).find((b) => href.startsWith(b));
      const ok = base ? locais[base] : true;
      return { ok } as Response;
    }
    return { ok: true } as Response;
  });
}

describe("offline — deteccao de arquivos locais", () => {
  it("usa o CDN quando vendor/ nao esta disponivel", async () => {
    vi.stubGlobal("fetch", fetchComLocais({ [BASE_VENDOR_LOCAL]: false }));
    expect(await vendorDisponivel()).toBe(false);
    const caminhos = await caminhosMediaPipe();
    expect(caminhos.local).toBe(false);
    expect(caminhos.modulo).toBe(`${BASE_MEDIAPIPE_CDN}/vision_bundle.mjs`);
    expect(caminhos.wasm).toBe(`${BASE_MEDIAPIPE_CDN}/wasm`);
  });

  it("prefere os caminhos locais quando vendor/ esta disponivel", async () => {
    vi.stubGlobal("fetch", fetchComLocais({ [BASE_VENDOR_LOCAL]: true }));
    const caminhos = await caminhosMediaPipe();
    expect(caminhos.local).toBe(true);
    expect(caminhos.modulo).toBe(`${BASE_VENDOR_LOCAL}/mediapipe/vision_bundle.mjs`);
    expect(caminhos.wasm).toBe(`${BASE_VENDOR_LOCAL}/mediapipe/wasm`);

    const ort = await caminhosOnnxRuntime();
    expect(ort.local).toBe(true);
    expect(ort.modulo).toBe(`${BASE_VENDOR_LOCAL}/onnxruntime/ort.min.mjs`);
    expect(ort.wasmPaths).toBe(`${BASE_VENDOR_LOCAL}/onnxruntime/`);

    expect(await moduloTransformers()).toBe(
      `${BASE_VENDOR_LOCAL}/transformers/transformers.min.js`
    );
  });

  it("cai para o CDN quando vendor/ esta ausente (ORT e Transformers)", async () => {
    vi.stubGlobal("fetch", fetchComLocais({ [BASE_VENDOR_LOCAL]: false }));
    const ort = await caminhosOnnxRuntime();
    expect(ort.modulo).toBe(`${BASE_ONNXRUNTIME_CDN}/dist/ort.min.mjs`);
    expect(ort.wasmPaths).toBe(`${BASE_ONNXRUNTIME_CDN}/dist/`);
    expect(await moduloTransformers()).toBe(BASE_TRANSFORMERS_CDN);
  });

  it("detecta modelos/ de forma independente de vendor/", async () => {
    vi.stubGlobal(
      "fetch",
      fetchComLocais({ [BASE_VENDOR_LOCAL]: false, [BASE_MODELOS_LOCAL]: true })
    );
    expect(await vendorDisponivel()).toBe(false);
    expect(await modelosDisponivel()).toBe(true);
    expect(baseModelosLocal()).toBe(BASE_MODELOS_LOCAL);
  });

  it("trata falha de rede como indisponivel, sem reter promessa rejeitada", async () => {
    let tentativas = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        tentativas += 1;
        if (tentativas === 1) throw new Error("offline");
        return { ok: true } as Response;
      })
    );
    expect(await vendorDisponivel()).toBe(false);
    // A nova tentativa reavalia (cache nao guarda o fracasso).
    expect(await vendorDisponivel()).toBe(true);
  });

  it("faz um unico HEAD por area (cache na sessao)", async () => {
    const fetchMock = fetchComLocais({ [BASE_VENDOR_LOCAL]: true });
    vi.stubGlobal("fetch", fetchMock);
    await vendorDisponivel();
    await vendorDisponivel();
    await caminhosMediaPipe();
    await moduloTransformers();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
