import { describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import { createServer } from "../../src/server";
import { realFetch, registrarAmbienteTeste, tmpDir } from "../helpers/server-test-setup";

registrarAmbienteTeste();

describe("POST /api/visao — perfil corporal neutro (Fase 2)", () => {
  it("com marcacoes e perfil neutro, mantem o modelo pedido e nao injeta a instrucao NSFW", async () => {
    let corpoVisao: Record<string, unknown> | null = null;
    const sse =
      [
        `data: ${JSON.stringify({ model: "m", choices: [{ delta: { content: "Homem com torso exposto." } }] })}`,
        `data: ${JSON.stringify({
          model: "m",
          choices: [{ delta: {}, finish_reason: "stop" }],
          usage: { completion_tokens: 9 },
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

    const server = createServer({
      logFile: `${tmpDir}/visao-corpo-neutro.jsonl`,
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
          perfilCorporal: "neutro",
          nsfw: [
            {
              rotulo: "male_breast_exposed",
              score: 0.62,
              caixa: { xmin: 0.1, ymin: 0.2, xmax: 0.5, ymax: 0.8 },
            },
          ],
        }),
      });
      expect(res.status).toBe(200);
      const eventos = (await res.text())
        .trim()
        .split("\n")
        .map((linha) => JSON.parse(linha) as { type: string; modelo?: string });
      expect(eventos.find((e) => e.type === "done")?.modelo).toBe("m");

      const corpo = corpoVisao as unknown as Record<string, unknown>;
      const conteudo = (corpo.messages as { content: unknown }[])[0].content as {
        type: string;
        text?: string;
      }[];
      expect(conteudo[0].text).toContain("DESCRICAO CORPORAL NEUTRA");
      expect(conteudo[0].text).toContain("male_breast_exposed (peitoral masculino exposto) 0.620");
      expect(conteudo[0].text).not.toContain("CONTEUDO ADULTO (NSFW)");
      expect(corpo.model).toBe("m");
    } finally {
      server.close();
    }
  });
});
