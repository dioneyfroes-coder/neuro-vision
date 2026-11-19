import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createServer } from "../src/server";
import { MODELO_PADRAO } from "../src/visao";
import { realFetch, registrarAmbienteTeste, tmpDir } from "./helpers/server-test-setup";

registrarAmbienteTeste();

describe("createServer", () => {
    it("GET /api/health informa o status do backend de visao", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          if (url.includes("/v1/models")) {
            return { ok: true, json: async () => ({ data: [{ id: "qwen2.5-vl-3b-instruct" }] }) };
          }
          if (url.includes("/api/v0/models")) return { ok: true, json: async () => ({ data: [] }) };
          return realFetch(input, init);
        })
      );

      // Diretorio de videos isolado: logs/videos/ é compartilhado com execucoes
      // E2E, entao nao pode determinar a contagem esperada de arquivos.
      const server = createServer({
        publicDir: tmpDir,
        videosDir: path.join(tmpDir, "videos-health"),
        backendUrl: "http://localhost:1234",
      });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as AddressInfo;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/health`);
        expect(res.status).toBe(200);
        const corpo = (await res.json()) as {
          ok: boolean;
          visao: { online: boolean; modelos: string[]; modelo: string };
          sistema: {
            cpu: { usoPercentual: number | null };
            ram: { rssBytes: number };
            gpu: { utilizacaoPercentual: null; motivo: string };
            armazenamento: { arquivos: number; bytesTotal: number };
          };
          monitoramento: { sessaoId: string | null; lacunas: number };
        };
        expect(corpo.visao.online).toBe(true);
        expect(corpo.visao.modelos).toContain("qwen2.5-vl-3b-instruct");
        expect(corpo.visao.modelo).toBeTruthy();
        expect(corpo.sistema.ram.rssBytes).toBeGreaterThan(0);
        expect(corpo.sistema.gpu.utilizacaoPercentual).toBeNull();
        expect(corpo.sistema.gpu.motivo).toContain("indisponivel");
        expect(corpo.sistema.armazenamento.arquivos).toBe(0);
        expect(corpo.monitoramento).toEqual({ sessaoId: null, estado: null, segmentos: 0, quadros: 0, lacunas: 0 });
      } finally {
        server.close();
      }
    });

    it("GET /api/health troca pelo melhor modelo quando o padrao nao esta instalado", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          if (url.includes("/v1/models")) {
            return { ok: true, json: async () => ({ data: [{ id: "qwen2.5vl:7b" }] }) };
          }
          if (url.includes("/api/v0/models")) return { ok: true, json: async () => ({ data: [] }) };
          return realFetch(input, init);
        })
      );

      const server = createServer({ publicDir: tmpDir, backendUrl: "http://localhost:1234" });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as AddressInfo;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/health`);
        expect(res.status).toBe(200);
        const corpo = (await res.json()) as {
          visao: { solicitado: string; modelo: string; modelos: string[] };
        };
        expect(corpo.visao.solicitado).toBe(MODELO_PADRAO);
        expect(corpo.visao.modelo).toBe("qwen2.5vl:7b");
      } finally {
        server.close();
      }
    });

    it("GET /api/health reporta o backend offline quando falha", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          if (url.includes("/v1/models")) throw new TypeError("fetch failed");
          if (url.includes("/api/v0/models")) throw new TypeError("fetch failed");
          return realFetch(input, init);
        })
      );

      const server = createServer({ publicDir: tmpDir });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as AddressInfo;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/health`);
        const corpo = (await res.json()) as { visao: { online: boolean } };
        expect(corpo.visao.online).toBe(false);
      } finally {
        server.close();
      }
    });

    it("GET /api/health lista os modelos que estao em memoria", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          if (url.includes("/v1/models")) {
            return { ok: true, json: async () => ({ data: [{ id: "qwen2.5-vl-3b-instruct" }] }) };
          }
          if (url.includes("/api/v0/models")) {
            return {
              ok: true,
              json: async () => ({ data: [{ id: "qwen2.5-vl-3b-instruct", state: "loaded" }] }),
            };
          }
          return realFetch(input, init);
        })
      );

      const server = createServer({ publicDir: tmpDir, backendUrl: "http://localhost:1234" });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as AddressInfo;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/health`);
        expect(res.status).toBe(200);
        const corpo = (await res.json()) as {
          ok: boolean;
          visao: { online: boolean; carregados: string[] };
        };
        expect(corpo.visao.online).toBe(true);
        expect(corpo.visao.carregados).toContain("qwen2.5-vl-3b-instruct");
      } finally {
        server.close();
      }
    });

    it("GET /api/health usa o REST v0 quando /v1/models vem vazio", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          if (url.includes("/v1/models")) {
            return { ok: true, json: async () => ({ data: [] }) };
          }
          if (url.includes("/api/v0/models")) {
            return {
              ok: true,
              json: async () => ({ data: [{ id: "qwen2.5-vl-3b-instruct", state: "loaded" }] }),
            };
          }
          return realFetch(input, init);
        })
      );

      const server = createServer({ publicDir: tmpDir, backendUrl: "http://localhost:1234" });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as AddressInfo;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/health`);
        expect(res.status).toBe(200);
        const corpo = (await res.json()) as {
          visao: { online: boolean; modelos: string[]; modelo: string };
        };
        expect(corpo.visao.online).toBe(true);
        expect(corpo.visao.modelos).toContain("qwen2.5-vl-3b-instruct");
        expect(corpo.visao.modelo).toBe("qwen2.5-vl-3b-instruct");
      } finally {
        server.close();
      }
    });
});
