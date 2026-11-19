import { afterEach, describe, expect, it, vi } from "vitest";
import {
  limparCacheModelo,
  melhorModeloDisponivel,
  mesmoModelo,
  modelosEmMemoria,
  modelosInstalados,
  normalizarNomeModelo,
} from "../../src/visao";

afterEach(() => {
  vi.unstubAllGlobals();
  limparCacheModelo();
});

describe("modelosEmMemoria", () => {
  it("lista apenas os modelos com state loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: "qwen2.5-vl-3b-instruct", state: "loaded" },
            { id: "llava", state: "not-loaded" },
          ],
        }),
      })
    );

    const memoria = await modelosEmMemoria({ baseUrl: "http://localhost:1234" });
    expect(memoria).toEqual(["qwen2.5-vl-3b-instruct"]);
  });

  it("aceita modelos sem o campo state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: "m" }] }) })
    );
    await expect(modelosEmMemoria()).resolves.toEqual(["m"]);
  });

  it("retorna lista vazia quando o endpoint falha", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(modelosEmMemoria()).resolves.toEqual([]);
  });
});

describe("normalizarNomeModelo", () => {
  it("preserva o nome, apenas removendo espacos", () => {
    expect(normalizarNomeModelo("qwen2.5-vl-3b-instruct")).toBe("qwen2.5-vl-3b-instruct");
    expect(normalizarNomeModelo("  qwen2.5-vl-3b-instruct  ")).toBe("qwen2.5-vl-3b-instruct");
  });

  it("retorna vazio para nome vazio", () => {
    expect(normalizarNomeModelo("")).toBe("");
    expect(normalizarNomeModelo("   ")).toBe("");
  });
});

describe("mesmoModelo", () => {
  it("ignora caixa e espacos", () => {
    expect(mesmoModelo("Qwen2.5-VL-3B", "qwen2.5-vl-3b")).toBe(true);
    expect(mesmoModelo(" qwen2.5-vl-3b ", "qwen2.5-vl-3b")).toBe(true);
  });

  it("distingue modelos diferentes", () => {
    expect(mesmoModelo("qwen2.5-vl-3b", "qwen2.5-vl-7b")).toBe(false);
  });

  it("retorna falso quando algum nome e vazio", () => {
    expect(mesmoModelo("", "")).toBe(false);
    expect(mesmoModelo("", "qwen2.5-vl-3b")).toBe(false);
  });
});

describe("melhorModeloDisponivel", () => {
  it("prefere o modelo de visao configurado aos demais", () => {
    expect(melhorModeloDisponivel(["llava", "qwen2.5-vl-3b-instruct"])).toBe(
      "qwen2.5-vl-3b-instruct"
    );
  });

  it("prefere um modelo de visao conhecido a um desconhecido", () => {
    expect(melhorModeloDisponivel(["foo", "llava"])).toBe("llava");
  });

  it("usa o primeiro da lista quando nenhum prefixo conhecido casa", () => {
    expect(melhorModeloDisponivel(["foo", "bar"])).toBe("foo");
  });

  it("devolve vazio quando nao ha instalados", () => {
    expect(melhorModeloDisponivel([])).toBe("");
  });
});

describe("modelosInstalados", () => {
  it("lista os modelos via /v1/models", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "qwen2.5-vl-3b-instruct" }, { id: "llava" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(modelosInstalados({ baseUrl: "http://localhost:1234" })).resolves.toEqual([
      "qwen2.5-vl-3b-instruct",
      "llava",
    ]);
    expect(String(fetchMock.mock.calls[0][0])).toBe("http://localhost:1234/v1/models");
  });

  it("devolve lista vazia quando /v1/models falha", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(modelosInstalados()).resolves.toEqual([]);
  });
});