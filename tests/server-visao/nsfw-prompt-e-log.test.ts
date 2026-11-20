import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createServer } from "../../src/server";
import { realFetch, registrarAmbienteTeste, tmpDir } from "../helpers/server-test-setup";

registrarAmbienteTeste();

describe("POST /api/visao - sucesso e NSFW", () => {
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
});
