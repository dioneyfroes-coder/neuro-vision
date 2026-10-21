import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  agregarEtapasIsoladas,
  agregarMetricasCiclos,
  avaliarComparabilidade,
  avaliarGateQualidade,
  ehCicloConcluido,
  extrairModelosDoJsonl,
  filtrarCiclosDaVariante,
  gravarRelatorioSeguro,
  identificarVarianteDoRegistro,
  modelosDosFrames,
  resumoDoClipe,
  separarWarmupCiclos,
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
  concluidoEm: "2026-10-20T12:00:00.000Z",
  ...extra,
});

describe("ehCicloConcluido", () => {
  it("exige ciclo nao cancelado, com frames e concluidoEm", () => {
    expect(ehCicloConcluido(registro())).toBe(true);
    expect(ehCicloConcluido(registro({ cancelado: true }))).toBe(false);
    expect(ehCicloConcluido(registro({ frameIds: [] }))).toBe(false);
    expect(ehCicloConcluido(registro({ concluidoEm: undefined }))).toBe(false);
    expect(ehCicloConcluido(null)).toBe(false);
  });
});

describe("agregarMetricasCiclos", () => {
  it("calcula mediana e P95 das etapas e conta erros/cancelados/concluidos", () => {
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
    expect(m.ciclosConcluidos).toBe(2);
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
// Fase 5 — warm-up x cold start
// ---------------------------------------------------------------------------

describe("separarWarmupCiclos", () => {
  const concluido = (cycleId, em) => ({
    sessionId: "variante-d",
    cycleId,
    frameIds: ["f1"],
    concluidoEm: em,
    metricas: { totalMs: 100 },
  });

  it("sem warm-ups devolve tudo no regime aquecido", () => {
    const regs = [concluido("c1", "2026-10-20T12:00:00Z"), concluido("c2", "2026-10-20T12:01:00Z")];
    const { warmup, aquecido } = separarWarmupCiclos(regs, 0);
    expect(warmup).toEqual([]);
    expect(aquecido).toHaveLength(2);
  });

  it("exclui os primeiros ciclos CONCLUIDOS por ordem de concluidoEm", () => {
    const regs = [
      concluido("c3", "2026-10-20T12:02:00Z"),
      concluido("c1", "2026-10-20T12:00:00Z"),
      concluido("c2", "2026-10-20T12:01:00Z"),
    ];
    const { warmup, aquecido } = separarWarmupCiclos(regs, 1);
    expect(warmup.map((r) => r.cycleId)).toEqual(["c1"]);
    expect(aquecido.map((r) => r.cycleId).sort()).toEqual(["c2", "c3"]);
  });

  it("nao conta ciclo cancelado como amostra de aquecimento", () => {
    const regs = [
      { sessionId: "variante-d", cycleId: "c0", frameIds: [], cancelado: true, metricas: {} },
      concluido("c1", "2026-10-20T12:00:00Z"),
      concluido("c2", "2026-10-20T12:01:00Z"),
    ];
    const { warmup, aquecido } = separarWarmupCiclos(regs, 1);
    expect(warmup.map((r) => r.cycleId)).toEqual(["c1"]);
    expect(aquecido.map((r) => r.cycleId)).toEqual(["c0", "c2"]);
  });

  it("pedir mais warm-ups que ciclos concluidos devolve todos como warm-up", () => {
    const regs = [concluido("c1", "2026-10-20T12:00:00Z")];
    const { warmup, aquecido } = separarWarmupCiclos(regs, 5);
    expect(warmup).toHaveLength(1);
    expect(aquecido).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Fase 5 — etapas isoladas x ciclo completo
// ---------------------------------------------------------------------------

describe("agregarEtapasIsoladas", () => {
  const ciclo = (metricas) => ({
    sessionId: "variante-d",
    cycleId: "c1",
    frameIds: ["f1"],
    concluidoEm: "2026-10-20T12:00:00Z",
    metricas,
  });

  it("mede cada etapa local e expoe a soma local x ciclo completo", () => {
    const regs = [
      ciclo({ capturaMs: 100, deteccaoMs: 200, poseMs: 50, temporalMs: 5, multimodalMs: 4000, totalMs: 4400 }),
      ciclo({ capturaMs: 120, deteccaoMs: 240, poseMs: 60, temporalMs: 5, multimodalMs: 4200, totalMs: 4700 }),
    ];
    const r = agregarEtapasIsoladas(regs);
    expect(r.ciclos).toBe(2);
    const det = r.etapas.find((e) => e.etapa === "deteccaoMs");
    expect(det.medianaMs).toBe(220);
    expect(det.amostras).toBe(2);
    expect(det.cobertura).toBe(1);
    // maosMs nunca foi registrado -> ausente, nao zero silencioso.
    expect(r.ausentes).toContain("maosMs");
    expect(r.etapas.find((e) => e.etapa === "maosMs").medianaMs).toBeNull();
    // Soma local mediana = 100+200+50+5 = 355 e 120+240+60+5 = 425 -> mediana 390.
    expect(r.somaLocalMedianaMs).toBe(390);
    expect(r.totalMedianaMs).toBe(4550);
    expect(r.multimodalMedianaMs).toBe(4100);
  });

  it("ignora etapas ausentes/zero em vez de contamina-las", () => {
    const r = agregarEtapasIsoladas([
      ciclo({ capturaMs: 100, deteccaoMs: 0, totalMs: 100 }),
      ciclo({ capturaMs: 100, deteccaoMs: 300, totalMs: 400 }),
    ]);
    const det = r.etapas.find((e) => e.etapa === "deteccaoMs");
    expect(det.amostras).toBe(1);
    expect(det.medianaMs).toBe(300);
    expect(det.cobertura).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// Fase 5 — gate de qualidade x latencia
// ---------------------------------------------------------------------------

describe("avaliarGateQualidade", () => {
  const resultado = (letra, f1, fpMin, totalMs) => ({
    variante: { letra },
    desempenho: { ciclosConcluidos: 3, metricas: { totalMs: { medianaMs: totalMs } } },
    qualidade: { consolidado: { f1, precisao: f1, recall: f1, falsosPositivosPorMinuto: fpMin } },
  });

  it("promove uma variante que atende qualidade e compensa a latencia", () => {
    const g = avaliarGateQualidade(
      [resultado("A", 0.4, 2, 1000), resultado("D", 0.7, 1, 1400)],
      { minF1: 0.5, maxFpMin: 2, ganhoMinimoF1: 0.1, custoMaximoLatencia: 1.5 }
    );
    const d = g.porVariante.find((p) => p.letra === "D");
    expect(d.atende).toBe(true);
    expect(d.promovivel).toBe(true);
    expect(d.ganhoF1).toBeCloseTo(0.3, 5);
    expect(d.taxaCusto).toBeCloseTo(1.4, 5);
  });

  it("mantem experimental quando o F1 fica abaixo do minimo", () => {
    const g = avaliarGateQualidade([resultado("A", 0.4, 0, 1000), resultado("C", 0.45, 0, 1200)], {
      minF1: 0.5,
      ganhoMinimoF1: 0,
      custoMaximoLatencia: 5,
    });
    const c = g.porVariante.find((p) => p.letra === "C");
    expect(c.atende).toBe(false);
    expect(c.promovivel).toBe(false);
    expect(g.experimentais).toContain("C");
  });

  it("mantem experimental quando o ganho de F1 nao compensa o custo de latencia", () => {
    const g = avaliarGateQualidade([resultado("A", 0.4, 0, 1000), resultado("D", 0.42, 0, 3000)], {
      minF1: 0.3,
      ganhoMinimoF1: 0.1,
      custoMaximoLatencia: 1.5,
    });
    const d = g.porVariante.find((p) => p.letra === "D");
    expect(d.atende).toBe(true);
    expect(d.promovivel).toBe(false);
    expect(d.motivo).toMatch(/ganho de F1|latencia/);
  });

  it("nao promove variante sem qualidade consolidada", () => {
    const semQualidade = {
      variante: { letra: "C" },
      desempenho: { ciclosConcluidos: 1, metricas: { totalMs: { medianaMs: 1000 } } },
      qualidade: { consolidado: null },
    };
    const g = avaliarGateQualidade([resultado("A", 0.4, 0, 1000), semQualidade], {});
    const c = g.porVariante.find((p) => p.letra === "C");
    expect(c.promovivel).toBe(false);
    expect(c.motivo).toMatch(/sem qualidade/);
  });

  it("usa A/B como referencia de latencia e qualidade", () => {
    const g = avaliarGateQualidade(
      [resultado("A", 0.3, 0, 5000), resultado("B", 0.5, 0, 2000), resultado("D", 0.8, 0, 2000)],
      { minF1: 0.5, ganhoMinimoF1: 0.1, custoMaximoLatencia: 1.5 }
    );
    expect(g.referencia.f1).toBeCloseTo(0.5, 5);
    expect(g.referencia.totalMedianaMs).toBe(2000);
    const d = g.porVariante.find((p) => p.letra === "D");
    expect(d.taxaCusto).toBeCloseTo(1, 5);
    expect(d.ganhoF1).toBeCloseTo(0.3, 5);
    expect(d.promovivel).toBe(true);
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
  const resultado = (letra, visao, deteccao = []) => ({
    variante: { letra },
    modelos: { visao, deteccao },
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

  it("ignora o modelo do detector local nos eventos", () => {
    const r = verificarMesmoModelo(
      [
        resultado("B", ["qwen2.5-vl-3b-instruct"], ["Xenova/yolos-tiny"]),
        resultado("D", ["qwen2.5-vl-3b-instruct"], ["outro-detector"]),
      ],
      "qwen2.5-vl-3b-instruct"
    );
    expect(r.consistente).toBe(true);
    expect(r.modelos).toEqual(["qwen2.5-vl-3b-instruct"]);
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
// Identidade dos clipes (mesmos bytes entre variantes)
// ---------------------------------------------------------------------------

describe("resumoDoClipe", () => {
  let dir;
  afterAll(() => dir && rm(dir, { recursive: true, force: true }));

  it("registra tamanho e SHA-256 estavel do clipe", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "neuro-bench-"));
    const arquivo = path.join(dir, "clipe.webm");
    await writeFile(arquivo, "conteudo-do-clipe", "utf8");
    const a = await resumoDoClipe(arquivo);
    const b = await resumoDoClipe(arquivo);
    expect(a.tamanhoBytes).toBe(17);
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(b.sha256).toBe(a.sha256);
  });

  it("devolve nulls quando o arquivo nao existe", async () => {
    const r = await resumoDoClipe(path.join(tmpdir(), "neuro-bench-nao-existe.webm"));
    expect(r).toEqual({ tamanhoBytes: null, sha256: null });
  });
});

// ---------------------------------------------------------------------------
// Criterio de comparabilidade (o harness nao conclui com dados invalidos)
// ---------------------------------------------------------------------------

describe("avaliarComparabilidade", () => {
  const resultadoComparavel = (letra, extra = {}) => {
    const L = letra.toLowerCase();
    return {
      variante: { letra },
      desempenho: { ciclos: 2, ciclosConcluidos: 2, cancelados: 0 },
      qualidade: { consolidado: { f1: 0.8, precisao: 0.8, recall: 0.8, falsosPositivosPorMinuto: 0 } },
      arquivoEventos: `logs/eventos-${letra}.jsonl`,
      arquivoCiclos: "logs/ciclos.jsonl",
      registros: [{ sessionId: `sessao-variante-${L}`, cycleId: `c-${L}` }],
      sessaoExplicita: false,
      modelos: { visao: ["qwen2.5-vl-3b-instruct"], deteccao: ["Xenova/yolos-tiny"] },
      ...extra,
    };
  };
  const quatro = () => ["A", "B", "C", "D"].map((l) => resultadoComparavel(l));
  const modelo = "qwen2.5-vl-3b-instruct";

  it("e conclusivo com ciclos concluidos, modelo verificado e qualidade propria", () => {
    const r = avaliarComparabilidade(quatro(), { modeloGlobal: modelo });
    expect(r.conclusivo).toBe(true);
    expect(r.problemas).toEqual([]);
    expect(r.porVariante).toHaveLength(4);
    expect(r.porVariante[1]).toMatchObject({ letra: "B", ciclosConcluidos: 2, qualidade: true });
  });

  it("recusa quando uma variante nao tem ciclo concluido", () => {
    const resultados = quatro();
    resultados[1] = resultadoComparavel("B", {
      desempenho: { ciclos: 2, ciclosConcluidos: 0, cancelados: 2 },
    });
    const r = avaliarComparabilidade(resultados, { modeloGlobal: modelo });
    expect(r.conclusivo).toBe(false);
    expect(r.problemas.some((p) => p.startsWith("B: 0 ciclo(s) concluido(s)"))).toBe(true);
  });

  it("recusa quando o modelo multimodal nao foi observado", () => {
    const resultados = quatro();
    resultados[2] = resultadoComparavel("C", { modelos: { visao: [], deteccao: ["Xenova/yolos-tiny"] } });
    const r = avaliarComparabilidade(resultados, { modeloGlobal: modelo });
    expect(r.conclusivo).toBe(false);
    expect(r.problemas.some((p) => p.includes("C: modelo multimodal nao observado"))).toBe(true);
  });

  it("recusa quando o mesmo arquivo de eventos serve a mais de uma variante", () => {
    const resultados = quatro();
    resultados[1] = resultadoComparavel("B", { arquivoEventos: "logs/eventos-comum.jsonl" });
    resultados[2] = resultadoComparavel("C", { arquivoEventos: "logs/eventos-comum.jsonl" });
    const r = avaliarComparabilidade(resultados, { modeloGlobal: modelo });
    expect(r.conclusivo).toBe(false);
    expect(r.problemas.some((p) => p.includes("arquivo de eventos compartilhado"))).toBe(true);
  });

  it("recusa quando o mesmo ciclo aparece em duas variantes", () => {
    const resultados = quatro();
    resultados[2] = resultadoComparavel("C", {
      registros: [{ sessionId: "sessao-variante-b", cycleId: "c-b" }],
    });
    const r = avaliarComparabilidade(resultados, { modeloGlobal: modelo });
    expect(r.conclusivo).toBe(false);
    expect(r.problemas.some((p) => p.includes("aparece nas variantes"))).toBe(true);
  });

  it("exige o minimo de ciclos concluidos informado", () => {
    const resultados = ["B", "D"].map((l) =>
      resultadoComparavel(l, { desempenho: { ciclos: 1, ciclosConcluidos: 1, cancelados: 0 } })
    );
    const r = avaliarComparabilidade(resultados, { modeloGlobal: modelo, minCiclosValidos: 2 });
    expect(r.conclusivo).toBe(false);
    expect(r.problemas.filter((p) => p.includes("abaixo do minimo 2"))).toHaveLength(2);
  });

  it("recusa sem modelo multimodal registrado", () => {
    const r = avaliarComparabilidade(quatro(), { modeloGlobal: "" });
    expect(r.conclusivo).toBe(false);
    expect(r.problemas.some((p) => p.includes("modelo multimodal nao registrado"))).toBe(true);
  });

  it("recusa sem qualidade consolidada", () => {
    const resultados = quatro();
    resultados[3] = resultadoComparavel("D", { qualidade: { consolidado: null } });
    const r = avaliarComparabilidade(resultados, { modeloGlobal: modelo });
    expect(r.conclusivo).toBe(false);
    expect(r.problemas.some((p) => p.includes("D: sem qualidade consolidada"))).toBe(true);
  });

  it("com --sem-qualidade conclui apenas pelo desempenho (sem eventos/qualidade)", () => {
    const resultados = quatro().map((r) => ({ ...r, arquivoEventos: null, qualidade: null }));
    const r = avaliarComparabilidade(resultados, { modeloGlobal: modelo, exigirQualidade: false });
    expect(r.conclusivo).toBe(true);
    expect(r.problemas).toEqual([]);
  });

  it("aceita sessao explicita mesmo quando o sessionId nao casa com a heuristica", () => {
    const resultados = quatro();
    resultados[1] = resultadoComparavel("B", {
      sessaoExplicita: true,
      registros: [{ sessionId: "sessao-custom", cycleId: "c-b" }],
    });
    const r = avaliarComparabilidade(resultados, { modeloGlobal: modelo });
    expect(r.conclusivo).toBe(true);
  });

  it("recusa comparar uma unica variante", () => {
    const r = avaliarComparabilidade([resultadoComparavel("D")], { modeloGlobal: modelo });
    expect(r.conclusivo).toBe(false);
    expect(r.problemas.some((p) => p.includes("menos de duas variantes"))).toBe(true);
  });

  it("usa o regime AQUECIDO para a contagem quando ha warm-up separado", () => {
    const resultados = quatro();
    // Bruto tem 2 concluidos; aquecido tem 0 (ambos eram warm-up).
    resultados[1] = resultadoComparavel("B", {
      desempenho: { ciclos: 2, ciclosConcluidos: 2, cancelados: 0 },
      desempenhoAquecido: { ciclos: 2, ciclosConcluidos: 0, cancelados: 0 },
      warmups: 2,
    });
    const r = avaliarComparabilidade(resultados, { modeloGlobal: modelo });
    expect(r.conclusivo).toBe(false);
    expect(r.problemas.some((p) => p.startsWith("B: 0 ciclo(s) concluido(s)"))).toBe(true);
    expect(r.porVariante.find((p) => p.letra === "B")).toMatchObject({ ciclosConcluidos: 0, warmups: 2 });
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
