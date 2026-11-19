import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createServer } from "../src/server";
import type { EntradaLog } from "../src/types";
import { registrarAmbienteTeste, tmpDir } from "./helpers/server-test-setup";

registrarAmbienteTeste();

describe("createServer", () => {
    it("responde POST /api/log gravando no arquivo configurado", async () => {
      const logFile = path.join(tmpDir, "visao.jsonl");
      const server = createServer({ logFile, publicDir: path.dirname(import.meta.url) });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as AddressInfo;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/log`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            timestamp: "2026-10-10T12:00:00.000Z",
            modelo: "meu-modelo",
            objetos: [{ nome: "pessoa", score: 0.9 }],
            resumo: "pessoa",
          }),
        });
        expect(res.status).toBe(200);
        const corpo = (await res.json()) as { ok: boolean };
        expect(corpo.ok).toBe(true);

        const linhas = (await readFile(logFile, "utf8")).trim().split("\n");
        expect(linhas).toHaveLength(1);
        expect(JSON.parse(linhas[0])).toMatchObject({ modelo: "meu-modelo" });
      } finally {
        server.close();
      }
    });

    it("POST /api/log preserva os campos de roteiro (papel, ms e tokens)", async () => {
      const logFile = path.join(tmpDir, "visao.jsonl");
      const server = createServer({ logFile, publicDir: tmpDir });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as AddressInfo;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/log`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tipo: "roteiro",
            papel: "delta",
            modelo: "qwen2.5vl:3b",
            resumo: "Pessoa sentou.",
            capturadoEm: "2026-10-11T00:00:01.000Z",
            ms: 1500,
            tokens: 12,
          }),
        });
        expect(res.status).toBe(200);
        const { entrada } = (await res.json()) as { entrada: Partial<EntradaLog> };
        expect(entrada).toMatchObject({
          tipo: "roteiro",
          papel: "delta",
          ms: 1500,
          tokens: 12,
          capturadoEm: "2026-10-11T00:00:01.000Z",
        });

        const linhas = (await readFile(logFile, "utf8")).trim().split("\n");
        expect(JSON.parse(linhas[0])).toMatchObject({
          tipo: "roteiro",
          papel: "delta",
          ms: 1500,
          tokens: 12,
          capturadoEm: "2026-10-11T00:00:01.000Z",
        });
      } finally {
        server.close();
      }
    });

    it("responde 404 para arquivo inexistente", async () => {
      const server = createServer({ publicDir: tmpDir });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as AddressInfo;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/nao-existe.html`);
        expect(res.status).toBe(404);
      } finally {
        server.close();
      }
    });

    it("envia COOP/COEP para habilitar WASM multithread", async () => {
      const server = createServer({ publicDir: tmpDir });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as AddressInfo;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/nao-existe.html`);
        expect(res.headers.get("cross-origin-opener-policy")).toBe("same-origin");
        expect(res.headers.get("cross-origin-embedder-policy")).toBe("credentialless");
      } finally {
        server.close();
      }
    });

    it("GET /vendor/ serve bibliotecas locais do modo offline", async () => {
      const vendorDir = await mkdtemp(path.join(os.tmpdir(), "neuro-vendor-"));
      await mkdir(path.join(vendorDir, "onnxruntime"), { recursive: true });
      await writeFile(path.join(vendorDir, "onnxruntime", "ort.min.mjs"), "// ort");
      await writeFile(path.join(vendorDir, "onnxruntime", "ort-wasm.wasm"), "wasm");

      const server = createServer({ publicDir: tmpDir, vendorDir });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as AddressInfo;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/vendor/onnxruntime/ort.min.mjs`);
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain("javascript");
        expect(await res.text()).toBe("// ort");
      } finally {
        server.close();
        await rm(vendorDir, { recursive: true, force: true });
      }
    });

    it("GET /vendor/ rejeita extensoes fora da allowlist", async () => {
      const vendorDir = await mkdtemp(path.join(os.tmpdir(), "neuro-vendor-"));
      await writeFile(path.join(vendorDir, "segredo.txt"), "conteudo");

      const server = createServer({ publicDir: tmpDir, vendorDir });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as AddressInfo;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/vendor/segredo.txt`);
        expect(res.status).toBe(403);
      } finally {
        server.close();
        await rm(vendorDir, { recursive: true, force: true });
      }
    });

    it("GET /vendor/ nao escapa da pasta (path traversal)", async () => {
      const vendorDir = await mkdtemp(path.join(os.tmpdir(), "neuro-vendor-"));

      const server = createServer({ publicDir: tmpDir, vendorDir });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as AddressInfo;

      try {
        const res = await fetch(
          `http://127.0.0.1:${port}/vendor/..%2f..%2fpackage.json`
        );
        expect([403, 404]).toContain(res.status);
      } finally {
        server.close();
        await rm(vendorDir, { recursive: true, force: true });
      }
    });

    it("GET /modelos/ serve pesos locais e responde 404 sem download", async () => {
      const modelosDir = await mkdtemp(path.join(os.tmpdir(), "neuro-modelos-"));
      await mkdir(path.join(modelosDir, "coco"), { recursive: true });
      await writeFile(path.join(modelosDir, "coco", "yolov10n.onnx"), "onnx");

      const server = createServer({ publicDir: tmpDir, modelosDir });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as AddressInfo;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/modelos/coco/yolov10n.onnx`);
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("application/octet-stream");

        const faltando = await fetch(`http://127.0.0.1:${port}/modelos/coco/yolov10s.onnx`);
        expect(faltando.status).toBe(404);
      } finally {
        server.close();
        await rm(modelosDir, { recursive: true, force: true });
      }
    });
});
