import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  agregarMetricasCiclos,
  extrairModelosDoJsonl,
  filtrarCiclosDaVariante,
  gravarRelatorioSeguro,
  identificarVarianteDoRegistro,
  modelosDosFrames,
  verificarMesmoModelo,
  VARIANTES_BENCHMARK,
} from "../../scripts/benchmark-variantes.mjs";

// ---------------------------------------------------------------------------
// Identificacao de variante pelos registros de ciclo
// ---------------------------------------------------------------------------

describe("identificarVarianteDoRegistro", () => {
  it("reconhece cada variante pelo sessionId (B/C checados antes de D)", () => {
    expect(identificarVarianteDoRegistro({ sessionId: "sessao-variante-a", cycleId: "c1" })).toBe("A");
    expect(identificarVarianteDoRegistro({ sessionId: "sessao-variante-b", cycleId: "c1" })).toBe("B");
    expect(identificarVarianteDoRegistro({ sessionId: "percepcao-sequencia-42", cycleId: "c1" })).toBe("B");
    expect(identificarVarianteDoRegistro({ sessionId: "sessao-variante-c", cycleId: "c1" })).toBe("C");
    expect(identificarVarianteDoRegistro({ sessionId: "percepcao-fundida-42", cycleId: "c1" })).toBe("C");
    expect(identificarVarianteDoRegistro({ sessionId: "sessao-percepcao", cycleId: "c1" })).toBe("D");
    expect(identificarVarianteDoRegistro({ sessionId: "baseline-webcam", cycleId: "c1" })).toBe("A");
    expect(identificarVarianteDoRegistro({ sessionId: "qualquer-coisa", cycleId: "c1" })).toBeNull();
    expect(identificarVarianteDoRegistro(null)).toBeNull();
  });

  it("filtra registros por sessao explicita quando informada", () => {
    const registros = [
      { sessionId: "abc", cycleId: "c1" },
      { sessionId: "xyz", cycleId: "c2" },
    ];
    expect(filtrarCiclosDaVariante(registros, "B", "xyz")).toHaveLength(1);
    expect(filtrarCiclosDaVariante(registros, "B", undefined)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Agregacao de metricas por etapa
// ---------------------------------------------------------------------------

const registro = (extra = {}) => ({
  sessionId: "variante-b",
  cycleId: "c1",
  frameIds: ["f1", "f2"],
  observacoes: 2,
  eventosTemporais: 1,
  subsistemasIndisponiveis: [],
  erros: [],
  metricas: { totalMs: 100, multimodalMs: 60 },
  cancelado: false,
  ...extra,
});

describe("agregarMetricasCiclos", () => {
  it("calcula mediana e P95 das etapas e conta erros/cancelados", () => {
    const registros = [
      registro({ metricas: { totalMs: 100, multimodalMs: 60 } }),
      registro({ cycleId: "c2", metricas: { totalMs: 200, multimodalMs: 80 } }),
      registro({
        cycleId: "c3",
        metricas: { totalMs: 300, multimodalMs: 100 },
        erros: [{ etapa: "multimodal", mensagem: "timeout" }],
        cancelado: true,
        eventosTemporais: 2,
      }),
    ];
    const m = agregarMetricasCiclos(registros);
    expect(m.ciclos).toBe(3);
    expect(m.metricas.totalMs.medianaMs).toBe(200);
    expect(m.metricas.totalMs.p95Ms).toBeCloseTo(290, 5);
    expect(m.metricas.totalMs.amostras).toBe(3);
    expect(m.metricas.multimodalMs.medianaMs).toBe(80);
    // Etapas sem valores ficam com amostras = 0 e mediana nula.
    expect(m.metricas.poseMs.medianaMs).toBeNull();
    expect(m.metricas.poseMs.amostras).toBe(0);
    expect(m.ciclosComErro).toBe(1);
    expect(m.errosPorEtapa).toEqual({ multimodal: 1 });
    expect(m.cancelados).toBe(1);
    expect(m.eventosTemporais).toBe(4);
    expect(m.observacoes).toBe(6);
    expect(m.framesPorCiclo).toBe(2);
  });

  it("ignora valores nao numericos e zero", () => {
    const m = agregarMetricasCiclos([
      registro({ metricas: { totalMs: 0, deteccaoMs: Number.NaN } }),
      registro({ cycleId: "c2", metricas: { totalMs: 50, deteccaoMs: 10 } }),
    ]);
    expect(m.metricas.totalMs.amostras).toBe(1);
    expect(m.metricas.deteccaoMs.medianaMs).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Garantia de mesmo modelo multimodal
// ---------------------------------------------------------------------------

describe("extrairModelosDoJsonl / modelosDosFrames", () => {
  let dir;
  afterAll(() => dir && rm(dir, { recursive: true, force: true }));

  it("extrai modelos distintos de um JSONL e ignora linhas corrompidas", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "neuro-bench-"));
    const arquivo = path.join(dir, "eventos.jsonl");
    await writeFile(
      arquivo,
      [
        JSON.stringify({ modelo: "qwen2.5-vl-3b-instruct" }),
        JSON.stringify({ modelo: "qwen2.5-vl-3b-instruct" }),
        JSON.stringify({ modelo: "gemma-3n-e4b" }),
        JSON.stringify({ semModelo: true }),
        "linha corrompida {",
        "",
      ].join("\n"),
      "utf8"
    );
    expect(await extrairModelosDoJsonl(arquivo)).toEqual(["gemma-3n-e4b", "qwen2.5-vl-3b-instruct"]);
  });

  it("resolve o modelo pelos frameIds dos ciclos em visao.jsonl", async () => {
    dir ??= await mkdtemp(path.join(tmpdir(), "neuro-bench-"));
    const visao = path.join(dir, "visao.jsonl");
    await writeFile(
      visao,
      [
        JSON.stringify({ frameId: "f-b1", modelo: "qwen2.5-vl-3b-instruct" }),
        JSON.stringify({ frameId: "f-b2", modelo: "qwen2.5-vl-3b-instruct" }),
        JSON.stringify({ frameId: "f-d1", modelo: "gemma-3n-e4b" }),
        JSON.stringify({ frameId: "f-sem-modelo" }),
        "lixo {",
      ].join("\n"),
      "utf8"
    );
    expect(await modelosDosFrames(visao, ["f-b1", "f-b2"])).toEqual(["qwen2.5-vl-3b-instruct"]);
    expect(await modelosDosFrames(visao, ["f-d1"])).toEqual(["gemma-3n-e4b"]);
    expect(await modelosDosFrames(visao, ["f-inexistente"])).toEqual([]);
    expect(await modelosDosFrames(visao, [])).toEqual([]);
    expect(await modelosDosFrames(path.join(dir, "nao-existe.jsonl"), ["f-b1"])).toEqual([]);
  });
});

describe("verificarMesmoModelo", () => {
  const resultado = (letra, visao, eventos = []) => ({
    variante: { letra },
    modelos: { visao, eventos },
  });

  it("confirma quando todas as variantes usaram o mesmo modelo", () => {
    const r = verificarMesmoModelo(
      [resultado("B", ["qwen2.5-vl-3b-instruct"]), resultado("D", ["qwen2.5-vl-3b-instruct"])],
      "qwen2.5-vl-3b-instruct"
    );
    expect(r.consistente).toBe(true);
    expect(r.modelos).toEqual(["qwen2.5-vl-3b-instruct"]);
    expect(r.avisos).toEqual([]);
  });

  it("alerta quando as variantes divergem", () => {
    const r = verificarMesmoModelo([
      resultado("B", ["qwen2.5-vl-3b-instruct"]),
      resultado("D", ["gemma-3n-e4b"]),
    ]);
    expect(r.consistente).toBe(false);
    expect(r.avisos.some((a) => a.includes("divergentes"))).toBe(true);
  });

  it("alerta quando uma variante difere do --modelo registrado", () => {
    const r = verificarMesmoModelo(
      [resultado("B", ["qwen2.5-vl-3b-instruct"]), resultado("C", ["gemma-3n-e4b"])],
      "qwen2.5-vl-3b-instruct"
    );
    expect(r.consistente).toBe(false);
    expect(r.avisos.some((a) => a.includes("variante C"))).toBe(true);
  });

  it("alerta quando nao ha dados para verificar", () => {
    const r = verificarMesmoModelo([resultado("A", [], [])], "");
    expect(r.consistente).toBe(false);
    expect(r.avisos.some((a) => a.includes("nao foi possivel verificar"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Gravacao segura (bench/BASELINE.md e imutavel)
// ---------------------------------------------------------------------------

describe("gravarRelatorioSeguro", () => {
  let dir;
  afterAll(() => dir && rm(dir, { recursive: true, force: true }));

  it("recusa qualquer caminho que resolva para BASELINE.md", async () => {
    await expect(gravarRelatorioSeguro("bench", "BASELINE.md", "x")).rejects.toThrow(/imutavel/i);
    await expect(gravarRelatorioSeguro("bench", "baseline.md", "x")).rejects.toThrow(/imutavel/i);
    await expect(gravarRelatorioSeguro("bench", "../bench/BASELINE.md", "x")).rejects.toThrow(/imutavel/i);
  });

  it("recusa nomes fora do padrao RELATORIO_VARIANTE_*/COMPARATIVO_*", async () => {
    await expect(gravarRelatorioSeguro("bench", "qualquer-coisa.md", "x")).rejects.toThrow(/padrao/i);
    await expect(gravarRelatorioSeguro("bench", "RELATORIO_VARIANTE_E_20260101.md", "x")).rejects.toThrow(/padrao/i);
  });

  it("grava relatorios e comparativos no padrao", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "neuro-bench-"));
    const rel = await gravarRelatorioSeguro(dir, "RELATORIO_VARIANTE_D_20260101.md", "# D");
    const cmp = await gravarRelatorioSeguro(dir, "COMPARATIVO_A_B_C_D_20260101.md", "# CMP");
    expect(rel.endsWith("RELATORIO_VARIANTE_D_20260101.md")).toBe(true);
    expect(cmp.endsWith("COMPARATIVO_A_B_C_D_20260101.md")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Matriz de variantes (espelha public/perception/variantes.ts)
// ---------------------------------------------------------------------------

describe("VARIANTES_BENCHMARK", () => {
  it("mantem a matriz A/B/C/D coerente com o roteiro", () => {
    expect(VARIANTES_BENCHMARK.map((v) => v.letra)).toEqual(["A", "B", "C", "D"]);
    const por = Object.fromEntries(VARIANTES_BENCHMARK.map((v) => [v.letra, v]));
    expect(por.A).toMatchObject({ imagens: 1, dadosLocais: false, temporal: "ausente" });
    expect(por.B).toMatchObject({ imagens: 4, dadosLocais: false, temporal: "ausente" });
    expect(por.C).toMatchObject({ imagens: 4, dadosLocais: true, temporal: "basico" });
    expect(por.D).toMatchObject({ imagens: 4, dadosLocais: true, temporal: "ampliado" });
    for (const v of VARIANTES_BENCHMARK) {
      if (v.dadosLocais) expect(v.percepcaoLocal).toBe(true);
    }
  });
});
