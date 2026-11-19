import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { mkdir, readFile, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { arquivosDeLog } from "../src/server";
import { hostExpostoNaRede } from "../src/server";
import { limparSnapshots } from "../src/server";
import { origemBloqueada } from "../src/server";
import { origensPermitidas } from "../src/server";
import { resolverCaminhoDentroDaBase } from "../src/server";
import { resolveStaticFile } from "../src/server";
import { validarPayloadLog } from "../src/server";
import { validarPayloadVisao } from "../src/server";
import { validarSnapshot } from "../src/server";
import type { PoliticaSnapshots } from "../src/server";
import { registrarAmbienteTeste, tmpDir } from "./helpers/server-test-setup";

registrarAmbienteTeste();

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
    expect(validarPayloadLog({ resumo: "ok", capturadoEm: 42 })).toContain("capturadoEm");
    expect(validarPayloadLog({ resumo: "ok", frameIds: ["f1", "f2"] })).toBeNull();
    expect(validarPayloadLog({ resumo: "ok", frameIds: "f1" })).toContain("frameIds");
    expect(validarPayloadLog({ resumo: "ok", nsfw: "x" })).toContain("nsfw");
    expect(validarPayloadLog({ resumo: "ok", nsfw: [] })).toBeNull();

    expect(validarPayloadVisao({ imagem: 42 })).toContain("imagem");
    expect(validarPayloadVisao({ imagem: "QkxPQ" })).toBeNull();
    expect(validarPayloadVisao({ imagem: "QkxPQ", frameIds: ["f1", "f2"] })).toBeNull();
    expect(validarPayloadVisao({ imagem: "QkxPQ", frameIds: "f1" })).toContain("frameIds");
    expect(validarPayloadVisao({ imagem: "QkxPQ", capturadoEm: false })).toContain("capturadoEm");
    expect(validarPayloadVisao({ imagem: "QkxPQ", nsfw: {} })).toContain("nsfw");
    expect(validarPayloadVisao({ imagem: "QkxPQ", nsfw: [] })).toBeNull();
    expect(validarPayloadVisao({ imagem: "QkxPQ", nsfwAtivo: "sim" })).toContain("nsfwAtivo");
    expect(validarPayloadVisao({ imagem: "QkxPQ", nsfwAtivo: true })).toBeNull();
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
