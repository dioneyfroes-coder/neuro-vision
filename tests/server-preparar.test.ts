import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createServer } from "../src/server";
import { realFetch, registrarAmbienteTeste, tmpDir } from "./helpers/server-test-setup";

registrarAmbienteTeste();

describe("createServer", () => {
    it("POST /api/visao registra visao_cancelada quando o cliente desconecta", async () => {
      let sinalizarInicio: () => void = () => {};
      const iniciou = new Promise<void>((resolve) => {
        sinalizarInicio = resolve;
      });

      vi.stubGlobal(
        "fetch",
        vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          if (url.includes("/v1/chat/completions")) {
            // Simula uma inferencia longa: o fetch so "termina" quando o sinal e
            // abortado (como o fetch real do Node), permitindo testar a
            // propagacao de cancelamento quando o cliente desconecta.
            sinalizarInicio();
            return new Promise((_resolve, reject) => {
              const sinal = init?.signal ?? undefined;
              const erro = new DOMException("abortado", "AbortError");
              if (sinal?.aborted) {
                reject(erro);
                return;
              }
              sinal?.addEventListener("abort", () => reject(erro));
            });
          }
          return realFetch(input, init);
        })
      );

      const espiao = vi.spyOn(console, "log").mockImplementation(() => {});
      const logFile = path.join(tmpDir, "visao.jsonl");
      const server = createServer({ logFile, publicDir: tmpDir, backendUrl: "http://localhost:1234" });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as AddressInfo;

      try {
        const controle = new AbortController();
        const pedido = fetch(`http://127.0.0.1:${port}/api/visao`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imagem: "data:image/jpeg;base64,QkxPQ" }),
          signal: controle.signal,
        }).catch(() => null);

        await iniciou;
        controle.abort();
        await pedido;

        await vi.waitFor(() => {
          const cancelou = espiao.mock.calls.some((call) =>
            String(call[0]).includes("visao_cancelada")
          );
          expect(cancelou).toBe(true);
        });

        // Cancelar nao grava entrada no historico.
        const conteudo = await readFile(logFile, "utf8").catch(() => "");
        expect(conteudo).toBe("");
      } finally {
        espiao.mockRestore();
        server.close();
      }
    });

    it("GET /api/visao/preparar confirma o modelo em memoria sem disparar geracao", async () => {
      const modeloAnterior = process.env.NEURO_MODEL;
      process.env.NEURO_MODEL = "qwen2.5-vl-3b-instruct";
      const geracoes: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          if (url.includes("/api/v0/models")) {
            return {
              ok: true,
              json: async () => ({ data: [{ id: "qwen2.5-vl-3b-instruct", state: "loaded" }] }),
            };
          }
          if (url.includes("/v1/models")) {
            return { ok: true, json: async () => ({ data: [{ id: "qwen2.5-vl-3b-instruct" }] }) };
          }
          if (url.includes("/v1/chat/completions")) {
            geracoes.push(url);
            return { ok: true, json: async () => ({ choices: [{ message: { content: "oi" } }] }) };
          }
          return realFetch(input, init);
        })
      );

      const server = createServer({ publicDir: tmpDir, backendUrl: "http://localhost:1234" });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as AddressInfo;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/visao/preparar`);
        expect(res.status).toBe(200);
        const corpo = (await res.json()) as { ok: boolean; carregado: boolean; carregandoMs: number };
        expect(corpo.ok).toBe(true);
        expect(corpo.carregado).toBe(true);
        expect(corpo.carregandoMs).toBe(0);
        expect(geracoes).toHaveLength(0);
      } finally {
        server.close();
        if (modeloAnterior === undefined) delete process.env.NEURO_MODEL;
        else process.env.NEURO_MODEL = modeloAnterior;
      }
    });

    it("GET /api/visao/preparar?modelo= carrega o modelo pedido pela interface", async () => {
      const geracoes: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          if (url.includes("/api/v0/models")) {
            return {
              ok: true,
              json: async () => ({
                data: [
                  { id: "qwen2.5-vl-3b-instruct", state: "loaded" },
                  { id: "gemma-4-e2b-uncensored-hauhaucs-aggressive", state: "loaded" },
                ],
              }),
            };
          }
          if (url.includes("/v1/models")) {
            return {
              ok: true,
              json: async () => ({
                data: [
                  { id: "qwen2.5-vl-3b-instruct" },
                  { id: "gemma-4-e2b-uncensored-hauhaucs-aggressive" },
                ],
              }),
            };
          }
          if (url.includes("/v1/chat/completions")) {
            const corpo = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
            geracoes.push(corpo.model ?? "");
            return { ok: true, json: async () => ({ choices: [{ message: { content: "oi" } }] }) };
          }
          return realFetch(input, init);
        })
      );

      const server = createServer({ publicDir: tmpDir, backendUrl: "http://localhost:1234" });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as AddressInfo;

      try {
        const res = await fetch(
          `http://127.0.0.1:${port}/api/visao/preparar?modelo=gemma-4-e2b-uncensored-hauhaucs-aggressive`
        );
        expect(res.status).toBe(200);
        const corpo = (await res.json()) as { ok: boolean; modelo: string; carregado: boolean };
        expect(corpo.ok).toBe(true);
        expect(corpo.carregado).toBe(true);
        // O modelo pedido pela interface vence o configurado no ambiente.
        expect(corpo.modelo).toBe("gemma-4-e2b-uncensored-hauhaucs-aggressive");
        // Ja estava em memoria: nada de geracao de teste.
        expect(geracoes).toHaveLength(0);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it("GET /api/visao/preparar confirma a carga no LM Studio sem introspecao de memoria", async () => {
      const modeloAnterior = process.env.NEURO_MODEL;
      process.env.NEURO_MODEL = "llama-3.2-11b-vision-instruct";
      const chats: string[] = [];
      const consultasV0: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          if (url.includes("/api/v0/models")) {
            // LM Studio sem o REST v0: nao da para confirmar a memoria.
            consultasV0.push(url);
            return { ok: false, status: 404, json: async () => ({}) };
          }
          if (url.includes("/v1/models")) {
            return { ok: true, json: async () => ({ data: [{ id: "llama-3.2-11b-vision-instruct" }] }) };
          }
          if (url.includes("/v1/chat/completions")) {
            chats.push(url);
            return {
              ok: true,
              json: async () => ({ choices: [{ message: { content: "oi" }, finish_reason: "stop" }] }),
            };
          }
          return realFetch(input, init);
        })
      );

      const server = createServer({
        publicDir: tmpDir,
        backendUrl: "http://localhost:1234",
      });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as AddressInfo;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/visao/preparar`);
        expect(res.status).toBe(200);
        const corpo = (await res.json()) as { ok: boolean; carregado: boolean };
        expect(corpo.carregado).toBe(true);
        expect(chats.length).toBeGreaterThan(0);
        // Sem endpoint de memoria, nao entra em polling (que faria ~60 consultas).
        expect(consultasV0.length).toBeLessThanOrEqual(6);
      } finally {
        server.close();
        if (modeloAnterior === undefined) delete process.env.NEURO_MODEL;
        else process.env.NEURO_MODEL = modeloAnterior;
      }
    });

    it("GET /api/visao/preparar nao confunde modelos diferentes", async () => {
      const modeloAnterior = process.env.NEURO_MODEL;
      process.env.NEURO_MODEL = "qwen2.5-vl-3b-instruct";
      const chats: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          if (url.includes("/api/v0/models")) {
            // Outro modelo esta carregado: nao e o solicitado.
            return { ok: true, json: async () => ({ data: [{ id: "qwen2.5-vl-7b", state: "loaded" }] }) };
          }
          if (url.includes("/v1/models")) {
            return { ok: true, json: async () => ({ data: [{ id: "qwen2.5-vl-3b-instruct" }] }) };
          }
          if (url.includes("/v1/chat/completions")) {
            chats.push(url);
            return { ok: false, status: 500, text: async (): Promise<string> => "boom" };
          }
          return realFetch(input, init);
        })
      );

      const server = createServer({ publicDir: tmpDir, backendUrl: "http://localhost:1234" });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as AddressInfo;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/visao/preparar`);
        // Nao declara pronto: tenta carregar o modelo solicitado e a carga falha.
        expect(res.status).toBe(502);
        expect(chats.length).toBeGreaterThan(0);
        const corpo = (await res.json()) as { ok: boolean };
        expect(corpo.ok).toBe(false);
      } finally {
        server.close();
        if (modeloAnterior === undefined) delete process.env.NEURO_MODEL;
        else process.env.NEURO_MODEL = modeloAnterior;
      }
    });
});
