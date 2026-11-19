import { afterEach, describe, expect, it, vi } from "vitest";
import {
  escolherModelo,
  limparCacheModelo,
  modeloEmMemoria,
  MODELO_PADRAO,
} from "../../src/visao";

afterEach(() => {
  vi.unstubAllGlobals();
  limparCacheModelo();
});

describe("escolherModelo", () => {
  it("respeita modelo explicito sem consultar o backend", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(escolherModelo({ modelo: "qwen2.5-vl-3b-instruct" })).resolves.toEqual({
      solicitado: "qwen2.5-vl-3b-instruct",
      modelo: "qwen2.5-vl-3b-instruct",
      alternativo: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("mantem o padrao quando ele esta instalado", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: MODELO_PADRAO }] }) })
    );
    await expect(escolherModelo()).resolves.toEqual({
      solicitado: MODELO_PADRAO,
      modelo: MODELO_PADRAO,
      alternativo: false,
    });
  });

  it("usa o melhor disponivel quando o padrao falta", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: "llava" }] }) })
    );
    await expect(escolherModelo()).resolves.toEqual({
      solicitado: MODELO_PADRAO,
      modelo: "llava",
      alternativo: true,
    });
  });

  it("mantem o configurado quando o backend esta offline", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(escolherModelo()).resolves.toMatchObject({
      solicitado: MODELO_PADRAO,
      modelo: MODELO_PADRAO,
      alternativo: false,
    });
  });

  it("cacheia a escolha entre chamadas", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: "llava" }] }) });
    vi.stubGlobal("fetch", fetchMock);
    await escolherModelo();
    await escolherModelo();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("modeloEmMemoria", () => {
  it("confirma apenas o modelo solicitado", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ id: "qwen2.5-vl-3b-instruct", state: "loaded" }] }),
      })
    );

    await expect(modeloEmMemoria({ modelo: "qwen2.5-vl-3b-instruct" })).resolves.toBe(true);
    await expect(modeloEmMemoria({ modelo: "qwen2.5-vl-7b" })).resolves.toBe(false);
  });

  it("nao informa carregado quando a memoria esta vazia", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) })
    );

    await expect(modeloEmMemoria({ modelo: "qwen2.5-vl-3b-instruct" })).resolves.toBe(false);
  });
});