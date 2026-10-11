import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import {
  appendEvento,
  appendLogEntry,
  appendOperacional,
  arquivosDeLog,
  arquivosDeMemoria,
  createServer,
  hostExpostoNaRede,
  lerEventos,
  lerLogEntries,
  lerOperacional,
  limparLog,
  limparSnapshots,
  logEvent,
  montarEntrada,
  nomeArquivoSnapshot,
  origemBloqueada,
  origensPermitidas,
  resolverCaminhoDentroDaBase,
  resolveStaticFile,
  salvarSnapshot,
  validarPayloadEvento,
  validarPayloadLog,
  validarPayloadVisao,
  validarSnapshot,
  type PoliticaSnapshots,
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

describe("nomeArquivoSnapshot", () => {
  it("extrai o nome do arquivo de uma URL de snapshot", () => {
    expect(nomeArquivoSnapshot("/snapshots/123-abc.jpg")).toBe("123-abc.jpg");
    expect(nomeArquivoSnapshot("123-abc.jpg")).toBe("123-abc.jpg");
    expect(nomeArquivoSnapshot("/snapshots/foto.PNG")).toBe("foto.PNG");
  });

  it("rejeita valores invalidos ou sem extensao de imagem", () => {
    expect(nomeArquivoSnapshot(undefined)).toBeNull();
    expect(nomeArquivoSnapshot(42)).toBeNull();
    expect(nomeArquivoSnapshot("/snapshots/..%2fsegredo.jsonl")).toBeNull();
    expect(nomeArquivoSnapshot("/snapshots/x.txt")).toBeNull();
    expect(nomeArquivoSnapshot("/snapshots/")).toBeNull();
  });
});

describe("seguranca de rede", () => {
  it("detecta hosts expostos na rede", () => {
    expect(hostExpostoNaRede("127.0.0.1")).toBe(false);
    expect(hostExpostoNaRede("127.0.0.5")).toBe(false);
    expect(hostExpostoNaRede("::1")).toBe(false);
    expect(hostExpostoNaRede("[::1]")).toBe(false);
    expect(hostExpostoNaRede("localhost")).toBe(false);
    expect(hostExpostoNaRede("0.0.0.0")).toBe(true);
    expect(hostExpostoNaRede("192.168.0.10")).toBe(true);
    expect(hostExpostoNaRede("::")).toBe(true);
    expect(hostExpostoNaRede("")).toBe(true);
  });

  it("lista origens extras a partir de CSV", () => {
    expect(origensPermitidas(undefined)).toEqual([]);
    expect(origensPermitidas("")).toEqual([]);
    expect(origensPermitidas(" http://a.com , http://b.com ")).toEqual([
      "http://a.com",
      "http://b.com",
    ]);
  });

  it("bloqueia origem cruzada e libera a propria", () => {
    expect(origemBloqueada(undefined, "127.0.0.1:3000", [])).toBe(false);
    expect(origemBloqueada("http://127.0.0.1:3000", "127.0.0.1:3000", [])).toBe(false);
    expect(origemBloqueada("http://evil.example", "127.0.0.1:3000", [])).toBe(true);
    expect(
      origemBloqueada("http://evil.example", "127.0.0.1:3000", ["http://evil.example"])
    ).toBe(false);
    expect(origemBloqueada("nao-e-url", "127.0.0.1:3000", [])).toBe(true);
  });

  it("valida tamanho e tipo do snapshot", () => {
    expect(validarSnapshot(undefined)).toBeNull();
    expect(validarSnapshot("")).toBeNull();
    expect(validarSnapshot(123)).toContain("snapshot");
    // 4 caracteres de base64 representam 3 bytes decodificados.
    expect(validarSnapshot("QUJD", 3)).toBeNull();
    expect(validarSnapshot("QUJD", 2)).toContain("limite");
  });

  it("valida tipos do payload de log e visao", () => {
    expect(validarPayloadLog([])).toContain("objeto");
    expect(validarPayloadLog({ objetos: "x" })).toContain("objetos");
    expect(validarPayloadLog({ resumo: 1 })).toContain("resumo");
    expect(validarPayloadLog({ objetos: [], resumo: "ok" })).toBeNull();

    expect(validarPayloadVisao({ imagem: 42 })).toContain("imagem");
    expect(validarPayloadVisao({ imagem: "QkxPQ" })).toBeNull();
  });
});

describe("limparSnapshots", () => {
  const politicaGenerosa: PoliticaSnapshots = { maxBytes: 10_000_000, maxFiles: 100, maxAgeMs: 0 };

  async function criarSnapshot(dir: string, nome: string, conteudo = "BLOB"): Promise<string> {
    await mkdir(dir, { recursive: true });
    const caminho = path.join(dir, nome);
    await writeFile(caminho, conteudo);
    return caminho;
  }

  function linhaSnapshot(url: string): string {
    return (
      JSON.stringify({
        timestamp: "x",
        modelo: "m",
        objetos: [],
        resumo: "r",
        tipo: "deteccao",
        snapshot: url,
      }) + "\n"
    );
  }

  it("mantem snapshots referenciados dentro da politica", async () => {
    const snapDir = path.join(tmpDir, "snapshots");
    await criarSnapshot(snapDir, "a.jpg");
    const logFile = path.join(tmpDir, "visao.jsonl");
    await writeFile(logFile, linhaSnapshot("/snapshots/a.jpg"));

    const resultado = await limparSnapshots({
      snapDir,
      logFiles: [logFile],
      politica: politicaGenerosa,
    });
    expect(resultado).toMatchObject({ removidos: 0, mantidos: 1, bytesLiberados: 0 });
    expect(resultado.erros).toEqual([]);
    expect(await readFile(path.join(snapDir, "a.jpg"), "utf8")).toBe("BLOB");
  });

  it("remove snapshots orfaos", async () => {
    const snapDir = path.join(tmpDir, "snapshots");
    const caminho = await criarSnapshot(snapDir, "orfa.jpg");
    const logFile = path.join(tmpDir, "visao.jsonl");
    await writeFile(logFile, "");

    const resultado = await limparSnapshots({
      snapDir,
      logFiles: [logFile],
      politica: politicaGenerosa,
    });
    expect(resultado.removidos).toBe(1);
    expect(resultado.mantidos).toBe(0);
    await expect(readFile(caminho)).rejects.toThrow();
  });

  it("remove snapshots expirados mesmo que referenciados", async () => {
    const snapDir = path.join(tmpDir, "snapshots");
    const caminho = await criarSnapshot(snapDir, "velho.jpg");
    const antigo = new Date("2026-01-01T00:00:00.000Z");
    await utimes(caminho, antigo, antigo);
    const logFile = path.join(tmpDir, "visao.jsonl");
    await writeFile(logFile, linhaSnapshot("/snapshots/velho.jpg"));

    const resultado = await limparSnapshots({
      snapDir,
      logFiles: [logFile],
      politica: { maxBytes: 0, maxFiles: 0, maxAgeMs: 24 * 60 * 60 * 1000 },
      agora: new Date("2026-10-10T00:00:00.000Z").getTime(),
    });
    expect(resultado.removidos).toBe(1);
    await expect(readFile(caminho)).rejects.toThrow();
  });

  it("respeita o teto de quantidade mantendo os snapshots mais novos", async () => {
    const snapDir = path.join(tmpDir, "snapshots");
    const antigo = await criarSnapshot(snapDir, "antigo.jpg");
    const meio = await criarSnapshot(snapDir, "meio.jpg");
    const novo = await criarSnapshot(snapDir, "novo.jpg");
    await utimes(antigo, new Date("2026-10-01T00:00:00Z"), new Date("2026-10-01T00:00:00Z"));
    await utimes(meio, new Date("2026-10-02T00:00:00Z"), new Date("2026-10-02T00:00:00Z"));
    await utimes(novo, new Date("2026-10-03T00:00:00Z"), new Date("2026-10-03T00:00:00Z"));
    const logFile = path.join(tmpDir, "visao.jsonl");
    await writeFile(
      logFile,
      linhaSnapshot("/snapshots/antigo.jpg") +
        linhaSnapshot("/snapshots/meio.jpg") +
        linhaSnapshot("/snapshots/novo.jpg")
    );

    const resultado = await limparSnapshots({
      snapDir,
      logFiles: [logFile],
      politica: { maxBytes: 0, maxFiles: 2, maxAgeMs: 0 },
    });
    expect(resultado.removidos).toBe(1);
    expect(resultado.mantidos).toBe(2);
    await expect(readFile(antigo)).rejects.toThrow();
    expect(await readFile(meio, "utf8")).toBe("BLOB");
    expect(await readFile(novo, "utf8")).toBe("BLOB");
  });

  it("respeita o teto de tamanho total", async () => {
    const snapDir = path.join(tmpDir, "snapshots");
    const antigo = await criarSnapshot(snapDir, "antigo.jpg", "AAAA");
    const novo = await criarSnapshot(snapDir, "novo.jpg", "BBBB");
    await utimes(antigo, new Date("2026-10-01T00:00:00Z"), new Date("2026-10-01T00:00:00Z"));
    await utimes(novo, new Date("2026-10-02T00:00:00Z"), new Date("2026-10-02T00:00:00Z"));
    const logFile = path.join(tmpDir, "visao.jsonl");
    await writeFile(
      logFile,
      linhaSnapshot("/snapshots/antigo.jpg") + linhaSnapshot("/snapshots/novo.jpg")
    );

    const resultado = await limparSnapshots({
      snapDir,
      logFiles: [logFile],
      politica: { maxBytes: 4, maxFiles: 0, maxAgeMs: 0 },
    });
    expect(resultado.removidos).toBe(1);
    expect(resultado.mantidos).toBe(1);
    await expect(readFile(antigo)).rejects.toThrow();
    expect(await readFile(novo, "utf8")).toBe("BBBB");
  });

  it("considera as referencias da ultima rotacao (.1)", async () => {
    const snapDir = path.join(tmpDir, "snapshots");
    await criarSnapshot(snapDir, "rotacao.jpg");
    const logFile = path.join(tmpDir, "visao.jsonl");
    await writeFile(logFile, "");
    await writeFile(`${logFile}.1`, linhaSnapshot("/snapshots/rotacao.jpg"));

    const resultado = await limparSnapshots({
      snapDir,
      logFiles: arquivosDeLog(logFile),
      politica: politicaGenerosa,
    });
    expect(resultado.removidos).toBe(0);
    expect(resultado.mantidos).toBe(1);
  });

  it("tolera diretorio ausente e falha de sistema de arquivos", async () => {
    const ausente = await limparSnapshots({
      snapDir: path.join(tmpDir, "sem-dir"),
      logFiles: [],
    });
    expect(ausente).toEqual({ removidos: 0, mantidos: 0, bytesLiberados: 0, erros: [] });

    const arquivo = path.join(tmpDir, "nao-e-diretorio");
    await writeFile(arquivo, "x");
    const falha = await limparSnapshots({ snapDir: arquivo, logFiles: [] });
    expect(falha.removidos).toBe(0);
    expect(falha.erros.length).toBe(1);
  });

  it("ignora um snapshot que sumiu entre a listagem e a limpeza", async () => {
    const snapDir = path.join(tmpDir, "snapshots");
    await criarSnapshot(snapDir, "a.jpg");
    const logFile = path.join(tmpDir, "visao.jsonl");
    await writeFile(logFile, "");

    const realUnlink = fs.promises.unlink.bind(fs.promises);
    const espiao = vi.spyOn(fs.promises, "unlink").mockImplementation(async (p) => {
      // Simula um arquivo que sumiu (ou nao pode ser removido) entre o stat e o unlink.
      if (String(p).endsWith("a.jpg")) {
        const erro = new Error("ENOENT") as NodeJS.ErrnoException;
        erro.code = "ENOENT";
        throw erro;
      }
      return realUnlink(p as Parameters<typeof realUnlink>[0]);
    });
    try {
      const resultado = await limparSnapshots({
        snapDir,
        logFiles: [logFile],
        politica: politicaGenerosa,
      });
      expect(resultado.removidos).toBe(0);
      expect(resultado.erros).toHaveLength(1);
    } finally {
      espiao.mockRestore();
    }
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

  it("GET /api/visao/preparar nao confunde modelos de mesma base com tags diferentes", async () => {
    const modeloAnterior = process.env.OLLAMA_MODEL;
    process.env.OLLAMA_MODEL = "qwen2.5vl:3b";
    const chats: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/api/ps")) {
          // Outra tag do mesmo modelo base esta carregada: nao e o solicitado.
          return { ok: true, json: async () => ({ models: [{ name: "qwen2.5vl:7b" }] }) };
        }
        if (url.includes("/api/chat")) {
          chats.push(url);
          return { ok: false, status: 500, text: async (): Promise<string> => "boom" };
        }
        return realFetch(input, init);
      })
    );

    const server = createServer({ publicDir: tmpDir, ollamaUrl: "http://localhost:11434" });
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
      if (modeloAnterior === undefined) delete process.env.OLLAMA_MODEL;
      else process.env.OLLAMA_MODEL = modeloAnterior;
    }
  });
});

describe("memoria persistente (eventos e operacional)", () => {
  it("validarPayloadEvento exige tipo, origem e descricao", () => {
    expect(validarPayloadEvento(null)).toBeTruthy();
    expect(validarPayloadEvento({ tipo: "aparicao" })).toBeTruthy();
    expect(validarPayloadEvento({ tipo: 1, origem: "rastreador", descricao: "x" })).toBeTruthy();
    expect(
      validarPayloadEvento({ tipo: "aparicao", origem: "rastreador", descricao: "apareceu" })
    ).toBeNull();
  });

  it("POST /api/eventos grava o evento e salva o snapshot", async () => {
    const logFile = path.join(tmpDir, "visao.jsonl");
    const eventosFile = path.join(tmpDir, "eventos.jsonl");
    const snapDir = path.join(tmpDir, "snapshots");
    const server = createServer({ logFile, eventosFile, snapDir, publicDir: tmpDir });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/eventos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo: "aparicao",
          origem: "rastreador",
          descricao: "apareceu pessoa",
          objetoId: "obj-1",
          confianca: 0.9,
          snapshot: "data:image/jpeg;base64,AAAA",
        }),
      });
      expect(res.status).toBe(200);
      const corpo = (await res.json()) as { ok: boolean; evento: { snapshot?: string } };
      expect(corpo.ok).toBe(true);
      expect(corpo.evento.snapshot).toMatch(/^\/snapshots\//);

      const evento = await lerEventos(eventosFile, 10);
      expect(evento).toHaveLength(1);
      expect(evento[0]).toMatchObject({ tipo: "aparicao", objetoId: "obj-1" });
    } finally {
      server.close();
    }
  });

  it("POST /api/eventos rejeita evento invalido", async () => {
    const logFile = path.join(tmpDir, "visao.jsonl");
    const eventosFile = path.join(tmpDir, "eventos.jsonl");
    const server = createServer({ logFile, eventosFile, publicDir: tmpDir });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/eventos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo: "inexistente", origem: "rastreador", descricao: "x" }),
      });
      expect(res.status).toBe(400);
      expect(await lerEventos(eventosFile, 10)).toHaveLength(0);
    } finally {
      server.close();
    }
  });

  it("GET /api/eventos lista os ultimos eventos (mais recente primeiro)", async () => {
    const logFile = path.join(tmpDir, "visao.jsonl");
    const eventosFile = path.join(tmpDir, "eventos.jsonl");
    await appendEvento(
      { id: "e1", timestamp: "t1", tipo: "aparicao", descricao: "primeiro", origem: "rastreador" },
      eventosFile
    );
    await appendEvento(
      { id: "e2", timestamp: "t2", tipo: "desaparecimento", descricao: "segundo", origem: "rastreador" },
      eventosFile
    );

    const server = createServer({ logFile, eventosFile, publicDir: tmpDir });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/eventos?limit=1`);
      expect(res.status).toBe(200);
      const corpo = (await res.json()) as { ok: boolean; eventos: { id: string }[] };
      expect(corpo.ok).toBe(true);
      expect(corpo.eventos).toHaveLength(1);
      expect(corpo.eventos[0].id).toBe("e2");
    } finally {
      server.close();
    }
  });

  it("appendOperacional/lerOperacional guardam registros operacionais", async () => {
    const operacionalFile = path.join(tmpDir, "operacional.jsonl");
    await appendOperacional(
      { timestamp: "t1", nivel: "aviso", origem: "servidor", mensagem: "primeiro" },
      operacionalFile
    );
    await appendOperacional(
      { timestamp: "t2", nivel: "erro", origem: "cliente", mensagem: "segundo" },
      operacionalFile
    );
    const lidos = await lerOperacional(operacionalFile, 10);
    expect(lidos.map((r) => r.mensagem)).toEqual(["segundo", "primeiro"]);
  });

  it("POST /api/operacional grava um registro sem virar evento visual", async () => {
    const logFile = path.join(tmpDir, "visao.jsonl");
    const eventosFile = path.join(tmpDir, "eventos.jsonl");
    const operacionalFile = path.join(tmpDir, "operacional.jsonl");
    const server = createServer({ logFile, eventosFile, operacionalFile, publicDir: tmpDir });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/operacional`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nivel: "erro", origem: "cliente", mensagem: "falha ao gravar" }),
      });
      expect(res.status).toBe(200);
      const conteudo = await readFile(operacionalFile, "utf8");
      expect(conteudo).toContain("falha ao gravar");
      expect(await lerEventos(eventosFile, 10)).toHaveLength(0);
    } finally {
      server.close();
    }
  });

  it("DELETE /api/logs limpa tambem os eventos", async () => {
    const logFile = path.join(tmpDir, "visao.jsonl");
    const eventosFile = path.join(tmpDir, "eventos.jsonl");
    await appendLogEntry(
      { timestamp: "x", modelo: "m", objetos: [], resumo: "a", tipo: "deteccao" },
      logFile
    );
    await appendEvento(
      { id: "e1", timestamp: "t", tipo: "aparicao", descricao: "x", origem: "rastreador" },
      eventosFile
    );

    const server = createServer({ logFile, eventosFile, publicDir: tmpDir });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/logs`, { method: "DELETE" });
      expect(res.status).toBe(200);
      expect(await readFile(logFile, "utf8")).toBe("");
      expect(await readFile(eventosFile, "utf8")).toBe("");
    } finally {
      server.close();
    }
  });

  it("limparSnapshots preserva snapshot referenciado por um evento", async () => {
    const logFile = path.join(tmpDir, "visao.jsonl");
    const eventosFile = path.join(tmpDir, "eventos.jsonl");
    const snapDir = path.join(tmpDir, "snapshots");
    await mkdir(snapDir, { recursive: true });
    await writeFile(path.join(snapDir, "vinculado.jpg"), "BLOB");
    await appendEvento(
      {
        id: "e1",
        timestamp: "t",
        tipo: "aparicao",
        descricao: "apareceu",
        origem: "rastreador",
        snapshot: "/snapshots/vinculado.jpg",
      },
      eventosFile
    );

    const resultado = await limparSnapshots({
      snapDir,
      logFiles: arquivosDeMemoria(logFile, eventosFile),
    });
    expect(resultado.removidos).toBe(0);
    expect(resultado.mantidos).toBe(1);
  });

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