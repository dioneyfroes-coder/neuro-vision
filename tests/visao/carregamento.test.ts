import { afterEach, describe, expect, it, vi } from "vitest";
import {
  forcarCarregamento,
  limparCacheModelo,
  memoriaIntrospectavel,
} from "../../src/visao";

afterEach(() => {
  vi.unstubAllGlobals();
  limparCacheModelo();
});

describe("forcarCarregamento", () => {
  it("nao chama o chat quando o modelo ja esta em memoria", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "m", state: "loaded" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const carga = await forcarCarregamento({ modelo: "m" });
    expect(carga).toBe(0);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/chat/completions"))).toBe(
      false
    );
  });

  it("carrega o modelo quando nao esta em memoria e espera confirma-lo", async () => {
    const calls: string[] = [];
    let psCount = 0;
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push(url);
      if (url.includes("/api/v0/models")) {
        psCount += 1;
        return {
          ok: true,
          json: async () =>
            psCount > 1
              ? { data: [{ id: "m", state: "loaded" }] }
              : { data: [] },
        };
      }
      if (url.includes("/chat/completions")) {
        return { ok: true, json: async () => ({ choices: [{ message: { content: "oi" } }] }) };
      }
      throw new Error(`URL inesperada: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const carga = await forcarCarregamento({ modelo: "m" });
    expect(carga).toBeGreaterThanOrEqual(0);
    expect(calls.some((u) => u.includes("/chat/completions"))).toBe(true);
    expect(calls.filter((u) => u.includes("/api/v0/models")).length).toBeGreaterThanOrEqual(2);
  });

  it("lanca erro quando a carga falha", async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/api/v0/models")) return { ok: true, json: async () => ({ data: [] }) };
      if (url.includes("/chat/completions"))
        return { ok: false, status: 404, text: async () => "model not found" };
      throw new Error("unexpected");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(forcarCarregamento({ modelo: "x" })).rejects.toThrow(/404/);
  });

  it("nao entra em polling quando o backend nao expoe a memoria", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push(url);
      if (url.includes("/api/v0/models")) return { ok: false, status: 404, json: async () => ({}) };
      if (url.includes("/chat/completions")) {
        return { ok: true, json: async () => ({ choices: [{ message: { content: "oi" } }] }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const inicio = Date.now();
    const carga = await forcarCarregamento({ modelo: "m", baseUrl: "http://localhost:1234" });
    expect(Date.now() - inicio).toBeLessThan(2000);
    expect(carga).toBeGreaterThanOrEqual(0);
    expect(calls.some((u) => u.includes("/chat/completions"))).toBe(true);
    expect(calls.filter((u) => u.includes("/api/v0/models")).length).toBeLessThanOrEqual(2);
  });
});

describe("memoriaIntrospectavel", () => {
  it("confirma quando o endpoint de memoria responde", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) })
    );
    await expect(memoriaIntrospectavel()).resolves.toBe(true);
  });

  it("nao confirma quando o endpoint de memoria falha", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(memoriaIntrospectavel()).resolves.toBe(false);
  });
});