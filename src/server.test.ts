import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import {
  appendLogEntry,
  createServer,
  lerLogEntries,
  limparLog,
  montarEntrada,
  resolveStaticFile,
} from "./server";
import type { EntradaLog } from "./types";

let tmpDir: string;

const realFetch = globalThis.fetch;

function stubOllamaFetch(
  resposta: () => Promise<unknown>,
  captura?: (corpo: Record<string, unknown>) => void
): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/api/generate")) {
        if (init?.body) captura?.(JSON.parse(String(init.body)) as Record<string, unknown>);
        return { ok: true, json: resposta };
      }
      return realFetch(input, init);
    })
  );
}

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "neuro-vision-"));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(tmpDir, { recursive: true, force: true });
});

describe("montarEntrada", () => {
  it("preenche valores padrao quando o payload esta vazio", () => {
    const entrada = montarEntrada({});
    expect(entrada.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(entrada.modelo).toBe("desconhecido");
    expect(entrada.objetos).toEqual([]);
    expect(entrada.resumo).toBe("");
    expect(entrada.tipo).toBe("deteccao");
  });

  it("normaliza objetos invalidos", () => {
    const entrada = montarEntrada({
      objetos: [{ nome: "pessoa", score: 0.9 }, "lixo", null],
    });
    expect(entrada.objetos).toHaveLength(1);
    expect(entrada.objetos[0].nome).toBe("pessoa");
  });
});

describe("appendLogEntry", () => {
  it("grava uma linha JSON por entrada", async () => {
    const arquivo = path.join(tmpDir, "visao.jsonl");
    const entrada: EntradaLog = {
      timestamp: "2026-10-10T12:00:00.000Z",
      modelo: "meu-modelo",
      objetos: [{ nome: "pessoa", rotulo: "person", score: 0.92, caixa: { xmin: 1, ymin: 2, xmax: 3, ymax: 4 } }],
      resumo: "pessoa",
      tipo: "deteccao",
    };

    await appendLogEntry(entrada, arquivo);
    await appendLogEntry(entrada, arquivo);
    await appendLogEntry(entrada, arquivo);

    const linhas = (await readFile(arquivo, "utf8")).trim().split("\n");
    expect(linhas).toHaveLength(3);
    expect(JSON.parse(linhas[0])).toMatchObject({ modelo: "meu-modelo", resumo: "pessoa" });
  });
});

describe("lerLogEntries", () => {
  it("retorna vazio quando o arquivo nao existe", async () => {
    expect(await lerLogEntries(path.join(tmpDir, "nao-existe.jsonl"))).toEqual([]);
  });

  it("retorna as entradas mais recentes primeiro e respeita o limite", async () => {
    const arquivo = path.join(tmpDir, "visao.jsonl");
    for (let i = 1; i <= 5; i++) {
      await appendLogEntry(
        {
          timestamp: `2026-10-10T12:00:0${i}.000Z`,
          modelo: "m",
          objetos: [],
          resumo: `entrada ${i}`,
          tipo: "deteccao",
        },
        arquivo
      );
    }
    const entradas = await lerLogEntries(arquivo, 2);
    expect(entradas).toHaveLength(2);
    expect(entradas[0].resumo).toBe("entrada 5");
    expect(entradas[1].resumo).toBe("entrada 4");
  });

  it("ignora linhas corrompidas", async () => {
    const arquivo = path.join(tmpDir, "visao.jsonl");
    await writeFile(arquivo, 'nao e json\n{"resumo":"ok","objetos":[],"timestamp":"x","modelo":"m","tipo":"deteccao"}\n');
    const entradas = await lerLogEntries(arquivo);
    expect(entradas).toHaveLength(1);
    expect(entradas[0].resumo).toBe("ok");
  });
});

describe("limparLog", () => {
  it("zera o conteudo do arquivo", async () => {
    const arquivo = path.join(tmpDir, "visao.jsonl");
    await appendLogEntry(
      { timestamp: "x", modelo: "m", objetos: [], resumo: "a", tipo: "deteccao" },
      arquivo
    );
    await limparLog(arquivo);
    expect(await readFile(arquivo, "utf8")).toBe("");
  });
});

describe("resolveStaticFile", () => {
  it("mapeia '/' para index.html", () => {
    expect(resolveStaticFile("/", tmpDir)).toBe(path.join(tmpDir, "index.html"));
  });

  it("bloqueia path traversal", () => {
    expect(resolveStaticFile("/..%2fpackage.json", tmpDir)).toBeNull();
    expect(resolveStaticFile("/%2e%2e%2f%2e%2e%2fpackage.json", tmpDir)).toBeNull();
    const colapsado = resolveStaticFile("/%2e%2e/package.json", tmpDir);
    expect(colapsado).not.toBeNull();
    expect(colapsado!.startsWith(tmpDir)).toBe(true);
  });
});

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

  it("POST /api/visao descreve via Ollama (mock) e grava log", async () => {
    let corpoOllama: Record<string, unknown> | null = null;
    stubOllamaFetch(
      async () => ({
        response: "Uma pessoa no escritorio.",
        model: "qwen3-vl:4b",
        eval_count: 10,
        total_duration: 2_000_000_000,
      }),
      (corpo) => {
        corpoOllama = corpo;
      }
    );

    const logFile = path.join(tmpDir, "visao.jsonl");
    const server = createServer({
      logFile,
      publicDir: tmpDir,
      ollamaUrl: "http://localhost:11434",
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
        }),
      });
      expect(res.status).toBe(200);
      const corpo = (await res.json()) as { descricao: string };
      expect(corpo.descricao).toBe("Uma pessoa no escritorio.");

      expect(corpoOllama).not.toBeNull();
      const corpoOllamaVisto = corpoOllama as unknown as Record<string, unknown>;
      expect(corpoOllamaVisto.prompt).toContain("Uma pessoa no sofa");
      expect(corpoOllamaVisto.options).toMatchObject({ num_predict: 140 });

      const linhas = (await readFile(logFile, "utf8")).trim().split("\n");
      expect(linhas).toHaveLength(1);
      expect(JSON.parse(linhas[0])).toMatchObject({
        resumo: "Uma pessoa no escritorio.",
        modelo: "qwen3-vl:4b",
        objetos: [],
        tipo: "descricao",
      });
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

  it("POST /api/visao com Ollama indisponivel retorna 502", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/api/generate")) {
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
});