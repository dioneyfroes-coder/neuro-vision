import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createServer } from "../../src/server";
import { montarPromptDescricao } from "../../src/visao";
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
});
