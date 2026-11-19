import { describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { appendLogEntry, createServer } from "../../src/server";
import { registrarAmbienteTeste, tmpDir } from "../helpers/server-test-setup";

registrarAmbienteTeste();

describe("memoria persistente - contexto", () => {
  it("GET /api/contexto reidrata roteiro e ultima descricao do historico", async () => {
    const logFile = path.join(tmpDir, "visao.jsonl");
    const eventosFile = path.join(tmpDir, "eventos.jsonl");
    await appendLogEntry(
      { timestamp: "t1", modelo: "m", objetos: [], resumo: "pessoa na sala", tipo: "descricao" },
      logFile
    );
    await appendLogEntry(
      { timestamp: "t2", modelo: "m", objetos: [], resumo: "virou a esquerda", tipo: "roteiro", papel: "delta" },
      logFile
    );

    const server = createServer({ logFile, eventosFile, publicDir: tmpDir });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/contexto`);
      expect(res.status).toBe(200);
      const corpo = (await res.json()) as {
        ok: boolean;
        roteiro: string[];
        ultimaDescricao: string;
        resumo: string;
      };
      expect(corpo.ok).toBe(true);
      expect(corpo.roteiro).toEqual(["virou a esquerda"]);
      expect(corpo.ultimaDescricao).toBe("virou a esquerda");
      expect(corpo.resumo).toContain("virou a esquerda");
    } finally {
      server.close();
    }
  });

  it("GET /api/contexto devolve contexto vazio sem historico (log vazio)", async () => {
    const logFile = path.join(tmpDir, "visao.jsonl");
    const eventosFile = path.join(tmpDir, "eventos.jsonl");
    const server = createServer({ logFile, eventosFile, publicDir: tmpDir });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/contexto`);
      expect(res.status).toBe(200);
      const corpo = (await res.json()) as { roteiro: string[]; ultimaDescricao: string; resumo: string };
      expect(corpo.roteiro).toEqual([]);
      expect(corpo.ultimaDescricao).toBe("");
      expect(corpo.resumo).toBe("");
    } finally {
      server.close();
    }
  });

  it("GET /api/contexto tolera linhas invalidas no arquivo de log", async () => {
    const logFile = path.join(tmpDir, "visao.jsonl");
    const eventosFile = path.join(tmpDir, "eventos.jsonl");
    await writeFile(
      logFile,
      [
        "{ linha corrompida",
        JSON.stringify({ timestamp: "t1", modelo: "m", objetos: [], resumo: "valida", tipo: "descricao" }),
      ].join("\n") + "\n",
      "utf8"
    );

    const server = createServer({ logFile, eventosFile, publicDir: tmpDir });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/contexto`);
      expect(res.status).toBe(200);
      const corpo = (await res.json()) as { ultimaDescricao: string };
      expect(corpo.ultimaDescricao).toBe("valida");
    } finally {
      server.close();
    }
  });
});
