import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  resolverCaminhoDentroDaBase,
  resolveStaticFile,
  salvarSnapshot,
} from "./server";
import type { EntradaLog } from "./types";
import { PROMPT_ROTEIRO_BASE } from "./ollama";

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

  it("resolve um arquivo dentro da base", () => {
    expect(resolveStaticFile("/style.css", tmpDir)).toBe(path.join(tmpDir, "style.css"));
  });

  it("bloqueia path traversal", () => {
    expect(resolveStaticFile("/..%2fpackage.json", tmpDir)).toBeNull();
    expect(resolveStaticFile("/%2e%2e%2f%2e%2e%2fpackage.json", tmpDir)).toBeNull();
    const colapsado = resolveStaticFile("/%2e%2e/package.json", tmpDir);
    expect(colapsado).toBe(path.join(tmpDir, "package.json"));
  });

  it("bloqueia separador do Windows codificado", () => {
    expect(resolveStaticFile("/..%5cpackage.json", tmpDir)).toBeNull();
  });

  it("bloqueia caminho absoluto para fora da base", () => {
    const absoluto = path.resolve(tmpDir, "..", "fora.txt");
    expect(resolverCaminhoDentroDaBase(tmpDir, absoluto)).toBeNull();
  });

  it("bloqueia irmao que compartilha o prefixo do diretorio permitido", () => {
    const irmao = `..${path.sep}${path.basename(tmpDir)}-segredo${path.sep}x.txt`;
    expect(resolverCaminhoDentroDaBase(tmpDir, irmao)).toBeNull();
    expect(resolveStaticFile(`/..%2f${path.basename(tmpDir)}-segredo%2fx.txt`, tmpDir)).toBeNull();
  });

  it("nao lanca com codificacao invalida", () => {
    expect(resolveStaticFile("/%E0%A4%A", tmpDir)).toBeNull();
    expect(resolveStaticFile("/%zz", tmpDir)).toBeNull();
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
        JSON.stringify({ message: { content: "Uma pessoa " }, model: "qwen3-vl:4b" }),
        JSON.stringify({
          message: { content: "no escritorio." },
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
        if (url.includes("/api/chat")) {
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
      const mensagens = corpoOllamaVisto.messages as { content: string }[];
      expect(mensagens[0].content).toContain("Uma pessoa no sofa");
      expect(corpoOllamaVisto.stream).toBe(true);
      expect(corpoOllamaVisto.think).toBe(false);
      expect(corpoOllamaVisto.options).toMatchObject({ num_predict: 256 });

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

  it("POST /api/visao no modo roteiro grava a base e colapsa repeticoes nos deltas", async () => {
    const corpos: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (!url.includes("/api/chat")) return realFetch(input, init);
        const corpo = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
        corpos.push(corpo);
        const prompt = (corpo.messages as { content: string }[])[0]?.content ?? "";
        const base = prompt === PROMPT_ROTEIRO_BASE;
        const inalterado = prompt.includes("MARCA_INALTERADO");
        const linhas = base
          ? [`${JSON.stringify({ message: { content: "Pessoa de pe." }, model: "qwen2.5vl:3b" })}`,
             `${JSON.stringify({ eval_count: 12, total_duration: 2_000_000_000, done: true })}`]
          : inalterado
            ? [`${JSON.stringify({ message: { content: "INALTERADO." }, model: "qwen2.5vl:3b" })}`,
               `${JSON.stringify({ eval_count: 3, total_duration: 800_000_000, done: true })}`]
            : [
                `${JSON.stringify({ message: { content: "A. B. A. B. A. B." }, model: "qwen2.5vl:3b" })}`,
                `${JSON.stringify({ eval_count: 10, total_duration: 1_000_000_000, done: true })}`,
              ];
        return { ok: true, body: new Response(linhas.join("\n") + "\n").body };
      })
    );

    const logFile = path.join(tmpDir, "visao.jsonl");
    const server = createServer({ logFile, publicDir: tmpDir, ollamaUrl: "http://localhost:11434" });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    const post = (payload: Record<string, unknown>): Promise<Response> =>
      fetch(`http://127.0.0.1:${port}/api/visao`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

    try {
      const resBase = await post({ imagem: "QkxPQ", modo: "roteiro", base: true, roteiro: "" });
      expect(resBase.status).toBe(200);
      const eventosBase = (await resBase.text()).trim().split("\n").map((l) => JSON.parse(l));
      const doneBase = eventosBase.find((e) => e.type === "done");
      expect(doneBase.descricao).toBe("Pessoa de pe.");
      expect(doneBase.tipo).toBe("roteiro");
      expect(doneBase.papel).toBe("base");
      const msgs0 = (corpos[0].messages as { content: string }[]);
      expect(msgs0[0].content).toBe(PROMPT_ROTEIRO_BASE);
      expect((corpos[0].options as { num_predict: number }).num_predict).toBe(320);

      const resDelta = await post({ imagem: "QkxPQ", modo: "roteiro", base: false, roteiro: "Pessoa de pe." });
      expect(resDelta.status).toBe(200);
      const doneDelta = (await resDelta.text()).trim().split("\n").map((l) => JSON.parse(l)).find((e) => e.type === "done");
      expect(doneDelta.descricao).toBe("A. B.");
      expect(doneDelta.tipo).toBe("roteiro");
      expect(doneDelta.papel).toBe("delta");
      const msgs1 = (corpos[1].messages as { content: string }[]);
      expect(msgs1[0].content).toContain("Pessoa de pe.");
      expect((corpos[1].options as { num_predict: number }).num_predict).toBe(160);

      const resInalterado = await post({
        imagem: "QkxPQ",
        modo: "roteiro",
        base: false,
        roteiro: "MARCA_INALTERADO",
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

  it("POST /api/visao com Ollama indisponivel retorna 502", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/api/chat")) {
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

  it("POST /api/visao com stream vazio do Ollama retorna 502 e nao grava log", async () => {
    const ndjson = JSON.stringify({ done: true, eval_count: 0 }) + "\n";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/api/chat")) return { ok: true, body: new Response(ndjson).body };
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
    const ndjson =
      [
        JSON.stringify({ message: { thinking: "Vamos analisar..." }, model: "qwen3-vl:4b" }),
        JSON.stringify({ model: "qwen3-vl:4b", eval_count: 40, done: true }),
      ].join("\n") + "\n";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/api/chat")) return { ok: true, body: new Response(ndjson).body };
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
      expect(corpo.erro).toContain("qwen2.5vl:3b");
      const conteudo = await readFile(logFile, "utf8").catch(() => "");
      expect(conteudo).toBe("");
    } finally {
      server.close();
    }
  });

  it("POST /api/visao com evento de erro do Ollama retorna 502 e nao grava log", async () => {
    const ndjson = JSON.stringify({ error: "model not loaded" }) + "\n";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/api/chat")) return { ok: true, body: new Response(ndjson).body };
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

  it("GET /api/health lista os modelos que estao em memoria", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/api/tags")) {
          return { ok: true, json: async () => ({ models: [{ name: "qwen3-vl:4b" }] }) };
        }
        if (url.includes("/api/ps")) {
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
        ollama: { online: boolean; carregados: string[] };
      };
      expect(corpo.ollama.online).toBe(true);
      expect(corpo.ollama.carregados).toContain("qwen3-vl:4b");
    } finally {
      server.close();
    }
  });

  it("GET /api/visao/preparar confirma o modelo em memoria sem disparar geracao", async () => {
    const geracoes: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/api/ps")) {
          return { ok: true, json: async () => ({ models: [{ name: "qwen2.5vl:3b" }] }) };
        }
        if (url.includes("/api/chat")) {
          geracoes.push(url);
          return { ok: true, json: async () => ({ message: { content: "oi" } }) };
        }
        return realFetch(input, init);
      })
    );

    const server = createServer({ publicDir: tmpDir, ollamaUrl: "http://localhost:11434" });
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
    }
  });
});