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
  logEvent,
  montarEntrada,
  resolveStaticFile,
  salvarSnapshot,
} from "./server";
import type { EntradaLog } from "./types";

let tmpDir: string;

const realFetch = globalThis.fetch;

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

  it("preenche score e caixa invalidos com valores seguros", () => {
    const entrada = montarEntrada({
      objetos: [{ nome: "pessoa", score: "alto", caixa: { xmin: 5, ymin: "x" } }],
    });
    expect(entrada.objetos).toHaveLength(1);
    expect(entrada.objetos[0].score).toBe(0);
    expect(entrada.objetos[0].rotulo).toBe("pessoa");
    expect(entrada.objetos[0].caixa).toEqual({ xmin: 5, ymin: 0, xmax: 0, ymax: 0 });
  });

  it("descarta objetos sem nome textual", () => {
    const entrada = montarEntrada({ objetos: [{ nome: 123 }, { nome: "ok" }] });
    expect(entrada.objetos).toHaveLength(1);
    expect(entrada.objetos[0].nome).toBe("ok");
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

describe("logEvent", () => {
  it("emite uma linha JSON com nivel e evento", () => {
    const espiao = vi.spyOn(console, "log").mockImplementation(() => {});
    logEvent("info", "teste", { a: 1 });
    expect(espiao).toHaveBeenCalledTimes(1);
    const linha = JSON.parse(String(espiao.mock.calls[0][0])) as Record<string, unknown>;
    expect(linha).toMatchObject({ nivel: "info", evento: "teste", a: 1 });
    expect(linha.ts).toMatch(/^\d{4}-/);
    espiao.mockRestore();
  });
});

describe("salvarSnapshot", () => {
  it("grava o arquivo e devolve a URL publica", async () => {
    const dir = path.join(tmpDir, "snapshots");
    const url = await salvarSnapshot("data:image/jpeg;base64,QkxPQg==", dir);
    expect(url).toMatch(/^\/snapshots\/.+\.jpg$/);
    const nome = url!.replace("/snapshots/", "");
    const conteudo = await readFile(path.join(dir, nome));
    expect(conteudo.toString("utf8")).toBe("BLOB");
  });

  it("retorna null quando nao ha imagem", async () => {
    expect(await salvarSnapshot("", tmpDir)).toBeNull();
    expect(await salvarSnapshot(undefined, tmpDir)).toBeNull();
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

  it("POST /api/visao descreve via Ollama (streaming mock) e grava log", async () => {
    let corpoOllama: Record<string, unknown> | null = null;
    const ndjson =
      [
        JSON.stringify({ response: "Uma pessoa ", model: "qwen3-vl:4b" }),
        JSON.stringify({
          response: "no escritorio.",
          model: "qwen3-vl:4b",
          eval_count: 10,
          total_duration: 2_000_000_000,
          done: true,
        }),
      ].join("\n") + "\n";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/api/generate")) {
          if (init?.body) corpoOllama = JSON.parse(String(init.body)) as Record<string, unknown>;
          return { ok: true, body: new Response(ndjson).body };
        }
        return realFetch(input, init);
      })
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
      const eventos = (await res.text())
        .trim()
        .split("\n")
        .map((linha) => JSON.parse(linha) as { type: string; descricao?: string; modelo?: string });
      const done = eventos.find((e) => e.type === "done");
      expect(done?.descricao).toBe("Uma pessoa no escritorio.");
      expect(done?.modelo).toBe("qwen3-vl:4b");

      expect(corpoOllama).not.toBeNull();
      const corpoOllamaVisto = corpoOllama as unknown as Record<string, unknown>;
      expect(corpoOllamaVisto.prompt).toContain("Uma pessoa no sofa");
      expect(corpoOllamaVisto.stream).toBe(true);
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

  it("GET /snapshots bloqueia path traversal", async () => {
    const server = createServer({ snapDir: path.join(tmpDir, "snapshots"), publicDir: tmpDir });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/snapshots/..%2f..%2fpackage.json`);
      expect([403, 404]).toContain(res.status);
    } finally {
      server.close();
    }
  });

  it("GET /api/health informa o status do Ollama", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/api/tags")) {
          return { ok: true, json: async () => ({ models: [{ name: "qwen3-vl:4b" }] }) };
        }
        return realFetch(input, init);
      })
    );

    const server = createServer({ publicDir: tmpDir, ollamaUrl: "http://localhost:11434" });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      expect(res.status).toBe(200);
      const corpo = (await res.json()) as {
        ok: boolean;
        ollama: { online: boolean; modelos: string[] };
      };
      expect(corpo.ollama.online).toBe(true);
      expect(corpo.ollama.modelos).toContain("qwen3-vl:4b");
    } finally {
      server.close();
    }
  });

  it("GET /api/health reporta Ollama offline quando falha", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/api/tags")) throw new TypeError("fetch failed");
        return realFetch(input, init);
      })
    );

    const server = createServer({ publicDir: tmpDir });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      const corpo = (await res.json()) as { ollama: { online: boolean } };
      expect(corpo.ollama.online).toBe(false);
    } finally {
      server.close();
    }
  });
});