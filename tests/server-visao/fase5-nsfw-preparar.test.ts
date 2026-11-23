import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createServer } from "../../src/server";
import { MODELO_NSFW } from "../../src/nsfw-prompt";
import { realFetch, registrarAmbienteTeste, tmpDir } from "../helpers/server-test-setup";

registrarAmbienteTeste();

describe("GET /api/visao/preparar?nsfw=1 (Fase 5)", () => {
  it("recusa modelo SFW pedido sem tentar fallback", async () => {
    const fetches: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        fetches.push(url);
        return realFetch(input, init);
      })
    );
    const server = createServer({
      logFile: path.join(tmpDir, "preparar-nsfw.jsonl"),
      publicDir: tmpDir,
      backendUrl: "http://localhost:1234",
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const res = await fetch(
        `http://127.0.0.1:${port}/api/visao/preparar?nsfw=1&modelo=qwen2.5-vl-3b-instruct`
      );
      expect(res.status).toBe(400);
      const corpo = (await res.json()) as {
        ok: boolean;
        erro: string;
        solicitado: string;
        modelo: string;
      };
      expect(corpo.ok).toBe(false);
      expect(corpo.solicitado).toBe("qwen2.5-vl-3b-instruct");
      expect(corpo.modelo).toBe(MODELO_NSFW);
      expect(corpo.erro).toContain("nao pode substitui-lo");
      expect(fetches.filter((url) => url.includes("localhost:1234"))).toEqual([]);
    } finally {
      server.close();
      vi.unstubAllGlobals();
    }
  });

  it("prepara somente o Gemma configurado e reporta solicitado/efetivo", async () => {
    const carregamentos: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/api/v0/models")) {
          return {
            ok: true,
            json: async () => ({ data: [{ id: MODELO_NSFW, state: "loaded" }] }),
          };
        }
        if (url.includes("/v1/models")) {
          return { ok: true, json: async () => ({ data: [{ id: MODELO_NSFW }] }) };
        }
        if (url.includes("/v1/chat/completions")) {
          const corpo = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
          carregamentos.push(corpo.model ?? "");
          return { ok: true, json: async () => ({ choices: [{ message: { content: "ok" } }] }) };
        }
        return realFetch(input, init);
      })
    );
    const server = createServer({
      logFile: path.join(tmpDir, "preparar-nsfw-ok.jsonl"),
      publicDir: tmpDir,
      backendUrl: "http://localhost:1234",
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/visao/preparar?nsfw=1`);
      expect(res.status).toBe(200);
      const corpo = (await res.json()) as {
        ok: boolean;
        solicitado: string;
        modelo: string;
        carregado: boolean;
        gemma?: { status: string; pronto: boolean };
      };
      expect(corpo).toMatchObject({ ok: true, solicitado: MODELO_NSFW, modelo: MODELO_NSFW });
      expect(corpo.gemma?.status).toBe("disponivel");
      expect(corpo.gemma?.pronto).toBe(true);
      // Já estava em memória, então nem houve inferência de teste; o que
      // importa é nunca carregar um modelo SFW no caminho NSFW.
      expect(carregamentos.every((modelo) => modelo === MODELO_NSFW)).toBe(true);
    } finally {
      server.close();
      vi.unstubAllGlobals();
    }
  });
});
