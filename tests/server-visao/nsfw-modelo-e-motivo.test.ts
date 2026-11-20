import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createServer } from "../../src/server";
import { MODELO_NSFW } from "../../src/nsfw-prompt";
import { realFetch, registrarAmbienteTeste, tmpDir } from "../helpers/server-test-setup";

registrarAmbienteTeste();

describe("POST /api/visao - sucesso e NSFW", () => {
  it("POST /api/visao com NSFW ativo forca o modelo gemma mesmo se outro for pedido", async () => {
    let corpoVisao: Record<string, unknown> | null = null;
    const sse =
      [
        `data: ${JSON.stringify({ model: MODELO_NSFW, choices: [{ delta: { content: "Conteudo adulto explicito." } }] })}`,
        `data: ${JSON.stringify({
          model: MODELO_NSFW,
          choices: [{ delta: {}, finish_reason: "stop" }],
          usage: { completion_tokens: 5 },
        })}`,
        "data: [DONE]",
      ].join("\n") + "\n";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/v1/chat/completions")) {
          if (init?.body) corpoVisao = JSON.parse(String(init.body)) as Record<string, unknown>;
          return { ok: true, body: new Response(sse).body };
        }
        return realFetch(input, init);
      })
    );

    const logFile = path.join(tmpDir, "visao-nsfw-modelo.jsonl");
    const server = createServer({
      logFile,
      publicDir: tmpDir,
      backendUrl: "http://localhost:1234",
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/visao`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imagem: "data:image/jpeg;base64,QkxPQ",
          modelo: "qwen2.5-vl-3b-instruct",
          nsfw: [],
        }),
      });
      expect(res.status).toBe(200);
      expect((corpoVisao as unknown as Record<string, unknown>).model).toBe(MODELO_NSFW);
    } finally {
      server.close();
    }
  });

  it("POST /api/visao com nsfwAtivo forca o gemma no fluxo multiframe", async () => {
    let corpoVisao: Record<string, unknown> | null = null;
    const sse =
      [
        `data: ${JSON.stringify({ model: MODELO_NSFW, choices: [{ delta: { content: '{"resumo":"ok"}' } }] })}`,
        `data: ${JSON.stringify({
          model: MODELO_NSFW,
          choices: [{ delta: {}, finish_reason: "stop" }],
          usage: { completion_tokens: 5 },
        })}`,
        "data: [DONE]",
      ].join("\n") + "\n";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/v1/chat/completions")) {
          if (init?.body) corpoVisao = JSON.parse(String(init.body)) as Record<string, unknown>;
          return { ok: true, body: new Response(sse).body };
        }
        return realFetch(input, init);
      })
    );

    const logFile = path.join(tmpDir, "visao-multiframe-nsfw.jsonl");
    const server = createServer({
      logFile,
      publicDir: tmpDir,
      backendUrl: "http://localhost:1234",
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/visao`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imagens: ["data:image/jpeg;base64,QkxPQ"],
          prompt: "prompt explicito do ciclo multiframe",
          modelo: "qwen2.5-vl-3b-instruct",
          nsfwAtivo: true,
        }),
      });
      expect(res.status).toBe(200);
      expect((corpoVisao as unknown as Record<string, unknown>).model).toBe(MODELO_NSFW);
    } finally {
      server.close();
    }
  });

  it("POST /api/visao registra o motivo que acionou a analise", async () => {
    const sse =
      [
        `data: ${JSON.stringify({ model: "m", choices: [{ delta: { content: "Pessoa" } }] })}`,
        `data: ${JSON.stringify({
          model: "m",
          choices: [{ delta: { content: " na sala." }, finish_reason: "stop" }],
          usage: { completion_tokens: 5 },
        })}`,
        "data: [DONE]",
      ].join("\n") + "\n";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/v1/chat/completions")) {
          return { ok: true, body: new Response(sse).body };
        }
        return realFetch(input, init);
      })
    );

    const logFile = path.join(tmpDir, "visao.jsonl");
    const server = createServer({
      logFile,
      publicDir: tmpDir,
      backendUrl: "http://localhost:1234",
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/visao`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imagem: "data:image/jpeg;base64,QkxPQ",
          motivo: "nova_entidade",
          capturadoEm: "2020-01-01T00:00:00.000Z",
        }),
      });
      expect(res.status).toBe(200);
      const eventos = (await res.text())
        .trim()
        .split("\n")
        .map((linha) => JSON.parse(linha) as { type: string; motivo?: string });
      expect(eventos.find((e) => e.type === "done")?.motivo).toBe("nova_entidade");

      const linhas = (await readFile(logFile, "utf8")).trim().split("\n");
      const gravada = JSON.parse(linhas[0]) as { capturadoEm?: string; timestamp: string };
      expect(gravada).toMatchObject({
        resumo: "Pessoa na sala.",
        motivo: "nova_entidade",
        capturadoEm: "2020-01-01T00:00:00.000Z",
      });
      // copia no instante da analise, depois da captura: atraso positivo
      expect(Date.parse(gravada.capturadoEm!)).toBeLessThan(Date.parse(gravada["timestamp"]));
    } finally {
      server.close();
    }
  });
});
