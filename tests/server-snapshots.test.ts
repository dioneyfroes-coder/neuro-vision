import { describe, expect, it } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { appendLogEntry } from "../src/server";
import { createServer } from "../src/server";
import { registrarAmbienteTeste, tmpDir } from "./helpers/server-test-setup";

registrarAmbienteTeste();

describe("createServer", () => {
    it("GET /api/logs devolve as entradas mais recentes", async () => {
      const logFile = path.join(tmpDir, "visao.jsonl");
      await appendLogEntry(
        { timestamp: "2026-10-10T12:00:00.000Z", modelo: "m", objetos: [], resumo: "antiga", tipo: "deteccao" },
        logFile
      );
      await appendLogEntry(
        { timestamp: "2026-10-10T12:00:05.000Z", modelo: "m", objetos: [], resumo: "nova", tipo: "deteccao" },
        logFile
      );

      const server = createServer({ logFile, publicDir: tmpDir });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as AddressInfo;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/logs?limit=1`);
        expect(res.status).toBe(200);
        const corpo = (await res.json()) as { ok: boolean; entradas: { resumo: string }[] };
        expect(corpo.ok).toBe(true);
        expect(corpo.entradas).toHaveLength(1);
        expect(corpo.entradas[0].resumo).toBe("nova");
      } finally {
        server.close();
      }
    });

    it("DELETE /api/logs limpa o arquivo de log", async () => {
      const logFile = path.join(tmpDir, "visao.jsonl");
      await appendLogEntry(
        { timestamp: "x", modelo: "m", objetos: [], resumo: "a", tipo: "deteccao" },
        logFile
      );

      const server = createServer({ logFile, publicDir: tmpDir });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as AddressInfo;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/logs`, { method: "DELETE" });
        expect(res.status).toBe(200);
        expect(await readFile(logFile, "utf8")).toBe("");
      } finally {
        server.close();
      }
    });

    it("DELETE /api/logs remove tambem a rotacao e os snapshots orfaos", async () => {
      const logFile = path.join(tmpDir, "visao.jsonl");
      const snapDir = path.join(tmpDir, "snapshots");
      await mkdir(snapDir, { recursive: true });
      const ref = path.join(snapDir, "ref.jpg");
      await writeFile(ref, "BLOB");
      await appendLogEntry(
        {
          timestamp: "x",
          modelo: "m",
          objetos: [],
          resumo: "a",
          tipo: "deteccao",
          snapshot: "/snapshots/ref.jpg",
        },
        logFile
      );
      await writeFile(`${logFile}.1`, "historico antigo\n");

      const server = createServer({ logFile, snapDir, publicDir: tmpDir });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as AddressInfo;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/logs`, { method: "DELETE" });
        expect(res.status).toBe(200);
        const corpo = (await res.json()) as { ok: boolean; snapshots: { removidos: number } };
        expect(corpo.ok).toBe(true);
        expect(corpo.snapshots.removidos).toBe(1);
        expect(await readFile(logFile, "utf8")).toBe("");
        await expect(readFile(`${logFile}.1`)).rejects.toThrow();
        await expect(readFile(ref)).rejects.toThrow();
      } finally {
        server.close();
      }
    });

    it("POST /api/log salva o snapshot e o serve em /snapshots", async () => {
      const logFile = path.join(tmpDir, "visao.jsonl");
      const snapDir = path.join(tmpDir, "snapshots");
      const server = createServer({ logFile, snapDir, publicDir: tmpDir });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as AddressInfo;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/log`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            modelo: "m",
            resumo: "pessoa",
            objetos: [],
            snapshot: "data:image/jpeg;base64,QkxPQg==",
          }),
        });
        expect(res.status).toBe(200);
        const { entrada } = (await res.json()) as { entrada: { snapshot?: string } };
        expect(entrada.snapshot).toMatch(/^\/snapshots\/.+\.jpg$/);

        const arquivo = await fetch(`http://127.0.0.1:${port}${entrada.snapshot}`);
        expect(arquivo.status).toBe(200);
        expect(await arquivo.text()).toBe("BLOB");
      } finally {
        server.close();
      }
    });

    it("POST /api/log rejeita tipos invalidos com 400 e nao grava", async () => {
      const logFile = path.join(tmpDir, "visao.jsonl");
      const server = createServer({ logFile, publicDir: tmpDir });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as AddressInfo;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/log`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ objetos: "nao-e-lista", resumo: "x" }),
        });
        expect(res.status).toBe(400);
        const corpo = (await res.json()) as { ok: boolean; erro?: string };
        expect(corpo.ok).toBe(false);
        expect(corpo.erro).toContain("objetos");
        const conteudo = await readFile(logFile, "utf8").catch(() => "");
        expect(conteudo).toBe("");
      } finally {
        server.close();
      }
    });

    it("POST /api/log rejeita snapshot acima do limite de upload", async () => {
      const anterior = process.env.SNAP_UPLOAD_MAX_BYTES;
      process.env.SNAP_UPLOAD_MAX_BYTES = "8";
      const logFile = path.join(tmpDir, "visao.jsonl");
      const snapDir = path.join(tmpDir, "snapshots");
      const server = createServer({ logFile, snapDir, publicDir: tmpDir });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as AddressInfo;

      try {
        const snapshot = "data:image/jpeg;base64," + Buffer.from("abcdefghijkl").toString("base64");
        const res = await fetch(`http://127.0.0.1:${port}/api/log`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resumo: "x", snapshot }),
        });
        expect(res.status).toBe(400);
        const corpo = (await res.json()) as { erro?: string };
        expect(corpo.erro).toContain("limite");
      } finally {
        server.close();
        if (anterior === undefined) delete process.env.SNAP_UPLOAD_MAX_BYTES;
        else process.env.SNAP_UPLOAD_MAX_BYTES = anterior;
      }
    });

    it("bloqueia requisicoes de origem cruzada com 403", async () => {
      const logFile = path.join(tmpDir, "visao.jsonl");
      const server = createServer({ logFile, publicDir: tmpDir });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as AddressInfo;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/log`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: "http://evil.example" },
          body: JSON.stringify({ resumo: "x" }),
        });
        expect(res.status).toBe(403);
        expect(await readFile(logFile, "utf8").catch(() => "")).toBe("");
      } finally {
        server.close();
      }
    });

    it("libera origem extra configurada em NEURO_ALLOWED_ORIGINS", async () => {
      const anterior = process.env.NEURO_ALLOWED_ORIGINS;
      process.env.NEURO_ALLOWED_ORIGINS = "http://parceiro.example";
      const logFile = path.join(tmpDir, "visao.jsonl");
      const server = createServer({ logFile, publicDir: tmpDir });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as AddressInfo;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/log`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: "http://parceiro.example" },
          body: JSON.stringify({ resumo: "x" }),
        });
        expect(res.status).toBe(200);
      } finally {
        server.close();
        if (anterior === undefined) delete process.env.NEURO_ALLOWED_ORIGINS;
        else process.env.NEURO_ALLOWED_ORIGINS = anterior;
      }
    });

    it("GET /snapshots bloqueia traversal, separadores codificados e irmaos semelhantes", async () => {
      const snapDir = path.join(tmpDir, "snapshots");
      const snapIrmao = path.join(tmpDir, "snapshots-irmanos");
      await mkdir(snapDir, { recursive: true });
      await mkdir(snapIrmao, { recursive: true });
      await writeFile(path.join(snapDir, "ok.jpg"), "BLOB");
      await writeFile(path.join(tmpDir, "segredo.jsonl"), "TOPSECRET");
      await writeFile(path.join(snapIrmao, "x.jpg"), "TOPSECRET");

      const server = createServer({ snapDir, publicDir: tmpDir });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as AddressInfo;
      const base = `http://127.0.0.1:${port}`;

      const tentarLer = async (url: string): Promise<Response> => fetch(base + url);

      try {
        const ok = await tentarLer("/snapshots/ok.jpg");
        expect(ok.status).toBe(200);
        expect(await ok.text()).toBe("BLOB");

        const ataques = [
          "/snapshots/..%2fsegredo.jsonl",
          "/snapshots/%2e%2e%2fsegredo.jsonl",
          "/snapshots/..%5csegredo.jsonl",
          "/snapshots/..%2fsnapshots-irmanos%2fx.jpg",
          "/snapshots/%2e%2e%2fsnapshots-irmanos%2fx.jpg",
          "/snapshots/..%2f..%2fsegredo.jsonl",
        ];
        for (const url of ataques) {
          const res = await tentarLer(url);
          expect(res.status).not.toBe(200);
          expect(await res.text()).not.toContain("TOPSECRET");
        }

        const invalido = await tentarLer("/snapshots/%E0%A4%A");
        expect([400, 403]).toContain(invalido.status);

        const ainda = await tentarLer("/snapshots/ok.jpg");
        expect(ainda.status).toBe(200);
      } finally {
        server.close();
      }
    });

    it("GET de estatico bloqueia traversal e codificacao invalida sem derrubar o servidor", async () => {
      const publicDir = path.join(tmpDir, "public");
      await mkdir(publicDir, { recursive: true });
      await writeFile(path.join(publicDir, "index.html"), "<html>ok</html>");
      await writeFile(path.join(tmpDir, "segredo.txt"), "TOPSECRET");

      const server = createServer({ publicDir, logFile: path.join(tmpDir, "visao.jsonl") });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as AddressInfo;
      const base = `http://127.0.0.1:${port}`;

      try {
        const raiz = await fetch(`${base}/`);
        expect(raiz.status).toBe(200);
        expect(await raiz.text()).toContain("ok");

        const ataques = ["/..%2fsegredo.txt", "/%2e%2e%2fsegredo.txt", "/..%5csegredo.txt"];
        for (const url of ataques) {
          const res = await fetch(base + url);
          expect(res.status).not.toBe(200);
          expect(await res.text()).not.toContain("TOPSECRET");
        }

        const invalido = await fetch(`${base}/%E0%A4%A`);
        expect([400, 403]).toContain(invalido.status);

        const ainda = await fetch(`${base}/`);
        expect(ainda.status).toBe(200);
      } finally {
        server.close();
      }
    });
});
