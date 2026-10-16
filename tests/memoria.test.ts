import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  appendJsonl,
  filtrarEventos,
  lerUltimosJsonl,
  limparJsonl,
  montarEvento,
  montarOperacional,
  reidratarContexto,
  resumirContexto,
} from "../src/memoria";
import type { EntradaLog, EventoVisual } from "../src/types";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "neuro-memoria-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("appendJsonl / lerUltimosJsonl", () => {
  it("grava e le os ultimos registros (mais recente primeiro)", async () => {
    const arquivo = path.join(tmpDir, "dados.jsonl");
    await appendJsonl({ n: 1 }, arquivo, 1_000_000);
    await appendJsonl({ n: 2 }, arquivo, 1_000_000);
    await appendJsonl({ n: 3 }, arquivo, 1_000_000);

    const ultimos = await lerUltimosJsonl<{ n: number }>(arquivo, 10);
    expect(ultimos.map((r) => r.n)).toEqual([3, 2, 1]);

    const soDois = await lerUltimosJsonl<{ n: number }>(arquivo, 2);
    expect(soDois.map((r) => r.n)).toEqual([3, 2]);
  });

  it("retorna lista vazia para arquivo inexistente ou limite zero", async () => {
    const arquivo = path.join(tmpDir, "nao-existe.jsonl");
    expect(await lerUltimosJsonl(arquivo, 10)).toEqual([]);

    const outro = path.join(tmpDir, "dados.jsonl");
    await appendJsonl({ n: 1 }, outro, 1_000_000);
    expect(await lerUltimosJsonl(outro, 0)).toEqual([]);
  });

  it("ignora linhas corrompidas", async () => {
    const arquivo = path.join(tmpDir, "misto.jsonl");
    await appendJsonl({ n: 1 }, arquivo, 1_000_000);
    await appendJsonl("linha solta", arquivo, 1_000_000); // JSON valido, mas nao objeto
    await appendJsonl({ n: 2 }, arquivo, 1_000_000);
    const lido = await lerUltimosJsonl<{ n: number }>(arquivo, 10, (v): v is { n: number } => {
      return typeof v === "object" && v !== null && "n" in v;
    });
    expect(lido.map((r) => r.n)).toEqual([2, 1]);
  });

  it("rotaciona o arquivo quando passa do limite de bytes", async () => {
    const arquivo = path.join(tmpDir, "grande.jsonl");
    const registro = { texto: "x".repeat(100) };
    await appendJsonl(registro, arquivo, 50);
    await appendJsonl(registro, arquivo, 50);
    expect(await readFile(`${arquivo}.1`, "utf8")).toContain("x");
  });

  it("limparJsonl zera o arquivo e remove a rotacao", async () => {
    const arquivo = path.join(tmpDir, "dados.jsonl");
    await appendJsonl({ n: 1 }, arquivo, 1_000_000);
    await appendJsonl({ n: 2 }, arquivo, 1_000_000);
    await limparJsonl(arquivo);
    expect(await readFile(arquivo, "utf8")).toBe("");
    await expect(readFile(`${arquivo}.1`)).rejects.toThrow();
  });
});

describe("montarEvento", () => {
  it("normaliza um evento valido", () => {
    const evento = montarEvento({
      tipo: "aparicao",
      origem: "rastreador",
      descricao: "apareceu pessoa",
      objetoId: "obj-1",
      confianca: 0.9,
    });
    expect(evento).toMatchObject({
      tipo: "aparicao",
      origem: "rastreador",
      descricao: "apareceu pessoa",
      objetoId: "obj-1",
      confianca: 0.9,
    });
    expect(evento?.id).toBeTruthy();
    expect(evento?.timestamp).toBeTruthy();
  });

  it("rejeita tipo, origem ou descricao invalidos", () => {
    expect(montarEvento(null)).toBeNull();
    expect(montarEvento([])).toBeNull();
    expect(montarEvento({ tipo: "inexistente", origem: "rastreador", descricao: "x" })).toBeNull();
    expect(montarEvento({ tipo: "aparicao", origem: "quem", descricao: "x" })).toBeNull();
    expect(montarEvento({ tipo: "aparicao", origem: "rastreador" })).toBeNull();
  });

  it("normaliza a origem legada 'ollama' para 'visao'", () => {
    const evento = montarEvento({ tipo: "aparicao", origem: "ollama", descricao: "apareceu pessoa" });
    expect(evento?.origem).toBe("visao");
  });

  it("descarta confianca nao numerica", () => {
    const evento = montarEvento({
      tipo: "movimento",
      origem: "rastreador",
      descricao: "x",
      confianca: Number.NaN,
    });
    expect(evento?.confianca).toBeUndefined();
  });

  it("preserva sessaoId, frameId e idempotencyKey", () => {
    const evento = montarEvento({
      tipo: "aparicao",
      origem: "rastreador",
      descricao: "apareceu pessoa",
      sessaoId: "ses-1",
      frameId: "frame-1",
      idempotencyKey: "chave-1",
    });
    expect(evento).toMatchObject({
      sessaoId: "ses-1",
      frameId: "frame-1",
      idempotencyKey: "chave-1",
    });
  });
});

describe("filtrarEventos", () => {
  const eventos: EventoVisual[] = [
    {
      id: "e1",
      timestamp: "2026-10-11T10:00:00.000Z",
      tipo: "aparicao",
      objetoId: "obj-1",
      descricao: "apareceu pessoa",
      confianca: 0.9,
      origem: "rastreador",
    },
    {
      id: "e2",
      timestamp: "2026-10-11T10:01:00.000Z",
      tipo: "movimento",
      objetoId: "obj-2",
      descricao: "movimento de gato",
      confianca: 0.5,
      origem: "rastreador",
    },
    {
      id: "e3",
      timestamp: "2026-10-11T10:02:00.000Z",
      tipo: "desaparecimento",
      objetoId: "obj-1",
      descricao: "desapareceu pessoa",
      origem: "rastreador",
    },
  ];

  it("sem filtros devolve tudo", () => {
    expect(filtrarEventos(eventos)).toHaveLength(3);
  });

  it("filtra por tipo (o que mudou)", () => {
    expect(filtrarEventos(eventos, { tipos: ["movimento"] }).map((e) => e.id)).toEqual(["e2"]);
    expect(
      filtrarEventos(eventos, { tipos: ["aparicao", "desaparecimento"] }).map((e) => e.id)
    ).toEqual(["e1", "e3"]);
  });

  it("filtra por objeto", () => {
    expect(filtrarEventos(eventos, { objetoId: "obj-1" }).map((e) => e.id)).toEqual(["e1", "e3"]);
  });

  it("filtra por janela temporal (quando) com bordas inclusivas", () => {
    const desdeMs = Date.parse("2026-10-11T10:01:00.000Z");
    const ateMs = Date.parse("2026-10-11T10:02:00.000Z");
    expect(filtrarEventos(eventos, { desdeMs, ateMs }).map((e) => e.id)).toEqual(["e2", "e3"]);
    expect(filtrarEventos(eventos, { desdeMs }).map((e) => e.id)).toEqual(["e2", "e3"]);
    expect(filtrarEventos(eventos, { ateMs: Date.parse("2026-10-11T10:00:00.000Z") }).map((e) => e.id)).toEqual(["e1"]);
  });

  it("combina tipo, objeto e janela", () => {
    const filtrados = filtrarEventos(eventos, {
      tipos: ["aparicao", "desaparecimento"],
      objetoId: "obj-1",
      desdeMs: Date.parse("2026-10-11T10:01:30.000Z"),
    });
    expect(filtrados.map((e) => e.id)).toEqual(["e3"]);
  });

  it("mantem eventos com timestamp invalido quando nao ha filtro temporal", () => {
    const semData: EventoVisual[] = [
      { id: "x", timestamp: "sem-data", tipo: "resumo", descricao: "r", origem: "visao" },
    ];
    expect(filtrarEventos(semData, { tipos: ["resumo"] })).toHaveLength(1);
  });
});

describe("montarOperacional", () => {
  it("aplica padroes e aceita detalhe", () => {
    const registro = montarOperacional({ mensagem: "falha ao gravar" });
    expect(registro).toMatchObject({
      nivel: "info",
      origem: "cliente",
      mensagem: "falha ao gravar",
    });
    expect(registro?.timestamp).toBeTruthy();
  });

  it("rejeita mensagem ausente ou vazia", () => {
    expect(montarOperacional({})).toBeNull();
    expect(montarOperacional({ mensagem: "" })).toBeNull();
    expect(montarOperacional(null)).toBeNull();
  });
});

describe("resumirContexto", () => {
  const entrada = (parcial: Partial<EntradaLog>): EntradaLog => ({
    timestamp: "2026-10-11T00:00:00.000Z",
    modelo: "m",
    objetos: [],
    resumo: "",
    tipo: "deteccao",
    ...parcial,
  });

  it("resume descricoes, objetos vistos e eventos", () => {
    const entradas = [
      entrada({ tipo: "descricao", resumo: "Uma pessoa na sala." }),
      entrada({
        tipo: "deteccao",
        objetos: [
          { nome: "pessoa", rotulo: "person", score: 0.9, caixa: { xmin: 0, ymin: 0, xmax: 1, ymax: 1 } },
        ],
      }),
    ];
    const eventos: EventoVisual[] = [
      { id: "e1", timestamp: "t", tipo: "aparicao", descricao: "apareceu pessoa", origem: "rastreador" },
    ];
    const contexto = resumirContexto(entradas, eventos);
    expect(contexto.resumo).toContain("Descricoes recentes: Uma pessoa na sala.");
    expect(contexto.resumo).toContain("Objetos vistos: pessoa");
    expect(contexto.resumo).toContain("Eventos recentes: apareceu pessoa");
    expect(contexto.entradas).toHaveLength(2);
    expect(contexto.eventos).toHaveLength(1);
  });

  it("respeita os limites de contagem e de caracteres", () => {
    const entradas = Array.from({ length: 10 }, (_, i) =>
      entrada({ tipo: "descricao", resumo: `descricao ${i}` })
    );
    const contexto = resumirContexto(entradas, [], { maxEntradas: 3, maxCaracteres: 20 });
    expect(contexto.entradas).toHaveLength(3);
    expect(contexto.resumo.length).toBeLessThanOrEqual(20);
  });

  it("produz resumo vazio quando nao ha dados", () => {
    const contexto = resumirContexto([], []);
    expect(contexto.resumo).toBe("");
    expect(contexto.entradas).toEqual([]);
    expect(contexto.eventos).toEqual([]);
  });
});

describe("reidratarContexto", () => {
  const entrada = (parcial: Partial<EntradaLog>): EntradaLog => ({
    timestamp: "2026-10-11T00:00:00.000Z",
    modelo: "m",
    objetos: [],
    resumo: "",
    tipo: "deteccao",
    ...parcial,
  });

  it("reconstroi roteiro e ultima descricao a partir do historico (mais novo primeiro)", () => {
    const entradas = [
      entrada({ tipo: "roteiro", papel: "delta", resumo: "passo 2" }),
      entrada({ tipo: "roteiro", papel: "delta", resumo: "passo 1" }),
      entrada({ tipo: "roteiro", papel: "base", resumo: "roteiro base" }),
      entrada({ tipo: "descricao", resumo: "pessoa na sala" }),
    ];
    const contexto = reidratarContexto(entradas, []);
    expect(contexto.roteiro).toEqual(["passo 1", "passo 2"]);
    expect(contexto.ultimaDescricao).toBe("passo 2");
    expect(contexto.resumo).toContain("pessoa na sala");
  });

  it("lida com historico vazio", () => {
    const contexto = reidratarContexto([], []);
    expect(contexto.roteiro).toEqual([]);
    expect(contexto.ultimaDescricao).toBe("");
    expect(contexto.resumo).toBe("");
  });

  it("respeita a janela maxima de entradas e caracteres", () => {
    const entradas = Array.from({ length: 10 }, (_, i) =>
      entrada({ tipo: "descricao", resumo: `descricao ${i}` })
    );
    const contexto = reidratarContexto(entradas, [], { maxEntradas: 2, maxCaracteres: 30 });
    expect(contexto.entradas).toHaveLength(2);
    expect(contexto.resumo.length).toBeLessThanOrEqual(30);
  });
});
