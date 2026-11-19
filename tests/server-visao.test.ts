import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createServer } from "../src/server";
import { montarPromptDescricao } from "../src/visao";
import { montarPromptRoteiro } from "../src/visao";
import { MODELO_NSFW } from "../src/nsfw-prompt";
import { realFetch, registrarAmbienteTeste, tmpDir } from "./helpers/server-test-setup";

registrarAmbienteTeste();

describe("createServer", () => {
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

    it("POST /api/visao recusa motivo invalido", async () => {
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
          body: JSON.stringify({ imagem: "data:image/jpeg;base64,QkxPQ", motivo: "sei-la" }),
        });
        expect(res.status).toBe(400);
      } finally {
        server.close();
      }
    });

    it("POST /api/visao no modo roteiro grava a base e colapsa repeticoes nos deltas", async () => {
      const corpos: Record<string, unknown>[] = [];
      const respostas = ["Pessoa de pe.", "A. B. A. B. A. B.", "INALTERADO."];
      let chamada = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          if (!url.includes("/v1/chat/completions")) return realFetch(input, init);
          const corpo = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
          corpos.push(corpo);
          const texto = respostas[Math.min(chamada, respostas.length - 1)];
          chamada += 1;
          const sse =
            [
              `data: ${JSON.stringify({
                model: "qwen2.5-vl-3b-instruct",
                choices: [{ delta: { content: texto }, finish_reason: "stop" }],
                usage: { completion_tokens: 12 },
              })}`,
              "data: [DONE]",
            ].join("\n") + "\n";
          return { ok: true, body: new Response(sse).body };
        })
      );

      const logFile = path.join(tmpDir, "visao.jsonl");
      const server = createServer({ logFile, publicDir: tmpDir, backendUrl: "http://localhost:1234" });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as AddressInfo;

      const post = (payload: Record<string, unknown>): Promise<Response> =>
        fetch(`http://127.0.0.1:${port}/api/visao`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

      const textoDoCorpo = (corpo: Record<string, unknown>): string => {
        const conteudo = (corpo.messages as { content: unknown }[])[0]?.content;
        if (Array.isArray(conteudo)) return (conteudo[0] as { text?: string }).text ?? "";
        return typeof conteudo === "string" ? conteudo : "";
      };

      try {
        const resBase = await post({ imagem: "QkxPQ", modo: "roteiro", base: true, roteiro: "" });
        expect(resBase.status).toBe(200);
        const eventosBase = (await resBase.text()).trim().split("\n").map((l) => JSON.parse(l));
        const doneBase = eventosBase.find((e) => e.type === "done");
        expect(doneBase.descricao).toBe("Pessoa de pe.");
        expect(doneBase.tipo).toBe("roteiro");
        expect(doneBase.papel).toBe("base");
        expect(textoDoCorpo(corpos[0])).toBe(montarPromptRoteiro(true));
        expect(corpos[0]).not.toHaveProperty("max_tokens");

        const resDelta = await post({ imagem: "QkxPQ", modo: "roteiro", base: false, roteiro: "Pessoa de pe." });
        expect(resDelta.status).toBe(200);
        const doneDelta = (await resDelta.text()).trim().split("\n").map((l) => JSON.parse(l)).find((e) => e.type === "done");
        expect(doneDelta.descricao).toBe("A. B.");
        expect(doneDelta.tipo).toBe("roteiro");
        expect(doneDelta.papel).toBe("delta");
        expect(textoDoCorpo(corpos[1])).toBe(montarPromptRoteiro(false));
        expect(corpos[1]).not.toHaveProperty("max_tokens");

        const resInalterado = await post({
          imagem: "QkxPQ",
          modo: "roteiro",
          base: false,
          roteiro: "Pessoa de pe.",
        });
        const doneInalterado = (await resInalterado.text())
          .trim()
          .split("\n")
          .map((l) => JSON.parse(l))
          .find((e) => e.type === "done");
        expect(doneInalterado.semMudanca).toBe(true);
        expect(doneInalterado.tipo).toBe("roteiro");
        expect(doneInalterado.papel).toBe("delta");

        const linhas = (await readFile(logFile, "utf8")).trim().split("\n");
        expect(linhas).toHaveLength(2);
        expect(JSON.parse(linhas[0])).toMatchObject({ tipo: "roteiro", papel: "base", resumo: "Pessoa de pe." });
        expect(JSON.parse(linhas[1])).toMatchObject({ tipo: "roteiro", papel: "delta", resumo: "A. B." });
      } finally {
        server.close();
      }
    });

    it("POST /api/visao sem imagem retorna 400", async () => {
      const server = createServer({ publicDir: tmpDir });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as AddressInfo;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/visao`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(400);
      } finally {
        server.close();
      }
    });

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
