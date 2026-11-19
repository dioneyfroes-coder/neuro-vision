import { describe, expect, it, vi } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { appendLogEntry } from "../src/server";
import { lerLogEntries } from "../src/server";
import { limparLog } from "../src/server";
import { logEvent } from "../src/server";
import { montarEntrada } from "../src/server";
import { nomeArquivoSnapshot } from "../src/server";
import { salvarSnapshot } from "../src/server";
import type { EntradaLog } from "../src/types";
import { registrarAmbienteTeste, tmpDir } from "./helpers/server-test-setup";

registrarAmbienteTeste();

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

  it("propaga o motivo valido que acionou a analise", () => {
    expect(montarEntrada({ motivo: "nova_entidade", resumo: "x" }).motivo).toBe("nova_entidade");
    expect(montarEntrada({ motivo: "qualquer-coisa" }).motivo).toBeUndefined();
    expect(montarEntrada({}).motivo).toBeUndefined();
  });

  it("preserva o instante de captura do frame (capturadoEm) e ignora valores invalidos", () => {
    expect(montarEntrada({ capturadoEm: "2026-10-11T00:00:01.000Z", resumo: "x" }).capturadoEm).toBe(
      "2026-10-11T00:00:01.000Z"
    );
    expect(montarEntrada({ capturadoEm: 42 }).capturadoEm).toBeUndefined();
    expect(montarEntrada({}).capturadoEm).toBeUndefined();
  });

  it("preserva os frameIds associados a inferencia multimodal", () => {
    expect(montarEntrada({ frameIds: ["f1", "f2"] }).frameIds).toEqual(["f1", "f2"]);
  });

  it("reconhece roteiro e preserva papel, ms e tokens", () => {
    const entrada = montarEntrada({
      tipo: "roteiro",
      papel: "base",
      ms: 1234,
      tokens: 56,
      resumo: "Pessoa de pe.",
    });
    expect(entrada.tipo).toBe("roteiro");
    expect(entrada.papel).toBe("base");
    expect(entrada.ms).toBe(1234);
    expect(entrada.tokens).toBe(56);
  });

  it("normaliza tipo desconhecido e descarta numeros invalidos", () => {
    expect(montarEntrada({ tipo: "qualquer" }).tipo).toBe("deteccao");
    const entrada = montarEntrada({ ms: "100", tokens: Number.NaN });
    expect(entrada.ms).toBeUndefined();
    expect(entrada.tokens).toBeUndefined();
  });

  it("so aceita papel em entradas do tipo roteiro", () => {
    expect(montarEntrada({ tipo: "deteccao", papel: "base" }).papel).toBeUndefined();
    expect(montarEntrada({ tipo: "roteiro", papel: "qualquer" }).papel).toBeUndefined();
    expect(montarEntrada({ tipo: "roteiro", papel: "delta" }).papel).toBe("delta");
  });

  it("normaliza marcacoes NSFW do payload, limitando score e caixa", () => {
    const entrada = montarEntrada({
      nsfw: [
        {
          rotulo: "porn",
          score: 1.7,
          caixa: { xmin: -1, ymin: 0.25, xmax: 2, ymax: 0.75 },
        },
        { rotulo: 123, score: 0.5, caixa: {} },
        "lixo",
      ],
    });
    expect(entrada.nsfw).toEqual([
      {
        rotulo: "porn",
        score: 1,
        caixa: { xmin: 0, ymin: 0.25, xmax: 1, ymax: 0.75 },
      },
    ]);
    expect(montarEntrada({ nsfw: [] }).nsfw).toEqual([]);
    expect(montarEntrada({}).nsfw).toBeUndefined();
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
