import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createServer } from "../../src/server";
import { montarPromptDescricao } from "../../src/visao";
import { MODELO_NSFW } from "../../src/nsfw-prompt";
import { realFetch, registrarAmbienteTeste, tmpDir } from "../helpers/server-test-setup";

registrarAmbienteTeste();

describe("POST /api/visao - sucesso e NSFW", () => {
  it("POST /api/visao descreve via backend de visao (streaming mock) e grava log", async () => {
    let corpoVisao: Record<string, unknown> | null = null;
    const sse =
      [
        `data: ${JSON.stringify({ model: "qwen2.5-vl-3b-instruct", choices: [{ delta: { content: "Uma pessoa " } }] })}`,
        `data: ${JSON.stringify({
          model: "qwen2.5-vl-3b-instruct",
          choices: [{ delta: { content: "no escritorio." }, finish_reason: "stop" }],
          usage: { completion_tokens: 10 },
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
          anterior: "Uma pessoa no sofa.",
          capturadoEm: "2026-11-02T19:00:00.000Z",
          frameIds: ["frame-a", "frame-b"],
        }),
      });
      expect(res.status).toBe(200);
      const eventos = (await res.text())
        .trim()
        .split("\n")
        .map((linha) => JSON.parse(linha) as { type: string; descricao?: string; modelo?: string });
      const done = eventos.find((e) => e.type === "done");
      expect(done?.descricao).toBe("Uma pessoa no escritorio.");
      expect(done?.modelo).toBe("qwen2.5-vl-3b-instruct");

      expect(corpoVisao).not.toBeNull();
      const corpoVisto = corpoVisao as unknown as Record<string, unknown>;
      const conteudo = (corpoVisto.messages as { content: unknown }[])[0].content as {
        type: string;
        text?: string;
      }[];
      // Cada foto e descrita do zero: a observacao anterior nao entra no prompt.
      expect(conteudo[0].type).toBe("text");
      expect(conteudo[0].text).toBe(montarPromptDescricao());
      expect(conteudo[1]).toMatchObject({ type: "image_url" });
      expect(corpoVisto.stream).toBe(true);
      expect(corpoVisto).not.toHaveProperty("max_tokens");
      expect(corpoVisto.temperature).toBe(0.2);
      expect(corpoVisto.top_p).toBe(0.9);

      const linhas = (await readFile(logFile, "utf8")).trim().split("\n");
      expect(linhas).toHaveLength(1);
      expect(JSON.parse(linhas[0])).toMatchObject({
        resumo: "Uma pessoa no escritorio.",
        modelo: "qwen2.5-vl-3b-instruct",
        objetos: [],
        tipo: "descricao",
        capturadoEm: "2026-11-02T19:00:00.000Z",
        frameIds: ["frame-a", "frame-b"],
      });
    } finally {
      server.close();
    }
  });

  it("POST /api/visao preserva NSFW no prompt e no log, com caixas normalizadas", async () => {
    let corpoVisao: Record<string, unknown> | null = null;
    const sse =
      [
        `data: ${JSON.stringify({ model: "m", choices: [{ delta: { content: "Pessoa nua, seios e genitais visiveis." } }] })}`,
        `data: ${JSON.stringify({
          model: "m",
          choices: [{ delta: {}, finish_reason: "stop" }],
          usage: { completion_tokens: 12 },
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

    const logFile = path.join(tmpDir, "visao-nsfw.jsonl");
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
          modelo: "m",
          nsfw: [
            {
              rotulo: "porn",
              score: 0.9,
              caixa: { xmin: 0.1, ymin: 0.2, xmax: 0.5, ymax: 0.8 },
            },
          ],
        }),
      });
      expect(res.status).toBe(200);
      const eventos = (await res.text())
        .trim()
        .split("\n")
        .map((linha) => JSON.parse(linha) as { type: string; nsfw?: unknown });
      const done = eventos.find((e) => e.type === "done");
      expect(done?.nsfw).toEqual([
        {
          rotulo: "porn",
          score: 0.9,
          caixa: { xmin: 0.1, ymin: 0.2, xmax: 0.5, ymax: 0.8 },
        },
      ]);

      const corpoVisto = corpoVisao as unknown as Record<string, unknown>;
      const conteudo = (corpoVisto.messages as { content: unknown }[])[0].content as {
        type: string;
        text?: string;
      }[];
      expect(conteudo[0].text).toContain("CONTEUDO ADULTO (NSFW)");
      expect(conteudo[0].text).toMatch(/sem eufemismos/i);
      expect(conteudo[0].text).toContain("porn 0.900");

      const linhas = (await readFile(logFile, "utf8")).trim().split("\n");
      expect(JSON.parse(linhas[0])).toMatchObject({
        resumo: "Pessoa nua, seios e genitais visiveis.",
        nsfw: [
          {
            rotulo: "porn",
            score: 0.9,
            caixa: { xmin: 0.1, ymin: 0.2, xmax: 0.5, ymax: 0.8 },
          },
        ],
      });
    } finally {
      server.close();
    }
  });

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
