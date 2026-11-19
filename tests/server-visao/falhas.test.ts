import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createServer } from "../../src/server";
import { realFetch, registrarAmbienteTeste, tmpDir } from "../helpers/server-test-setup";

registrarAmbienteTeste();

describe("POST /api/visao - falhas", () => {
  it("POST /api/visao com o backend indisponivel retorna 502", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/v1/chat/completions")) {
          throw new TypeError("fetch failed");
        }
        return realFetch(input, init);
      })
    );

    const server = createServer({ publicDir: tmpDir });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/visao`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imagem: "QkxPQ" }),
      });
      expect(res.status).toBe(502);
    } finally {
      server.close();
    }
  });

  it("POST /api/visao usa o timeout multimodal configurado", async () => {
    const timeoutAnterior = process.env.NEURO_VISION_TIMEOUT_MS;
    process.env.NEURO_VISION_TIMEOUT_MS = "20";
    let sinalRecebido: AbortSignal | undefined;
    let server: ReturnType<typeof createServer> | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/v1/chat/completions")) {
          const signal = init?.signal;
          if (!signal) throw new Error("signal de timeout ausente");
          sinalRecebido = signal;
          return new Promise<Response>((_resolve, reject) => {
            const abort = () => reject(signal.reason);
            if (signal.aborted) abort();
            else signal.addEventListener("abort", abort, { once: true });
          });
        }
        return realFetch(input, init);
      })
    );

    try {
      server = createServer({ publicDir: tmpDir });
      await new Promise<void>((resolve) => server?.listen(0, resolve));
      const { port } = server.address() as AddressInfo;
      const inicio = Date.now();
      const res = await fetch(`http://127.0.0.1:${port}/api/visao`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imagem: "QkxPQ", modelo: "m" }),
      });

      expect(res.status).toBe(500);
      expect((await res.json()).erro).toContain("tempo esgotado");
      expect(sinalRecebido).toBeInstanceOf(AbortSignal);
      expect(Date.now() - inicio).toBeLessThan(1500);
    } finally {
      server?.close();
      if (timeoutAnterior === undefined) delete process.env.NEURO_VISION_TIMEOUT_MS;
      else process.env.NEURO_VISION_TIMEOUT_MS = timeoutAnterior;
    }
  });

  it("POST /api/visao com stream vazio do backend retorna 502 e nao grava log", async () => {
    const sse =
      [
        `data: ${JSON.stringify({ model: "m", choices: [{ delta: {}, finish_reason: "stop" }] })}`,
        "data: [DONE]",
      ].join("\n") + "\n";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/v1/chat/completions")) return { ok: true, body: new Response(sse).body };
        return realFetch(input, init);
      })
    );

    const logFile = path.join(tmpDir, "visao.jsonl");
    const server = createServer({ logFile, publicDir: tmpDir });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/visao`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imagem: "QkxPQ" }),
      });
      expect(res.status).toBe(502);
      const corpo = (await res.json()) as { erro?: string };
      expect(corpo.erro).toContain("nenhum token de texto");
      const conteudo = await readFile(logFile, "utf8").catch(() => "");
      expect(conteudo).toBe("");
    } finally {
      server.close();
    }
  });

  it("POST /api/visao com modelo always-thinking retorna 502 com orientacao", async () => {
    const sse =
      [
        `data: ${JSON.stringify({ model: "m", choices: [{ delta: { reasoning_content: "Vamos analisar..." } }] })}`,
        `data: ${JSON.stringify({ model: "m", choices: [{ delta: {}, finish_reason: "stop" }] })}`,
        "data: [DONE]",
      ].join("\n") + "\n";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/v1/chat/completions")) return { ok: true, body: new Response(sse).body };
        return realFetch(input, init);
      })
    );

    const logFile = path.join(tmpDir, "visao.jsonl");
    const server = createServer({ logFile, publicDir: tmpDir });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/visao`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imagem: "QkxPQ" }),
      });
      expect(res.status).toBe(502);
      const corpo = (await res.json()) as { erro?: string };
      expect(corpo.erro).toContain("visao nao-pensante");
      const conteudo = await readFile(logFile, "utf8").catch(() => "");
      expect(conteudo).toBe("");
    } finally {
      server.close();
    }
  });

  it("POST /api/visao com evento de erro do backend retorna 502 e nao grava log", async () => {
    const sse = `data: ${JSON.stringify({ error: "model not loaded" })}\n` + "data: [DONE]\n";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/v1/chat/completions")) return { ok: true, body: new Response(sse).body };
        return realFetch(input, init);
      })
    );

    const logFile = path.join(tmpDir, "visao.jsonl");
    const server = createServer({ logFile, publicDir: tmpDir });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/visao`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imagem: "QkxPQ" }),
      });
      expect(res.status).toBe(502);
      const corpo = (await res.json()) as { erro?: string };
      expect(corpo.erro).toContain("model not loaded");
      const conteudo = await readFile(logFile, "utf8").catch(() => "");
      expect(conteudo).toBe("");
    } finally {
      server.close();
    }
  });
});
