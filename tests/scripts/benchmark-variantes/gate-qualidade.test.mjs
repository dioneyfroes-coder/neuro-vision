import { describe, expect, it } from "vitest";

import { avaliarGateQualidade } from "../../../scripts/benchmark-variantes.mjs";

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

  it("usa o regime aquecido no gate quando ha warm-up separado", () => {
    const g = avaliarGateQualidade([
      {
        variante: { letra: "D" },
        desempenho: { ciclosConcluidos: 10, metricas: { totalMs: { medianaMs: 5000 } } },
        desempenhoAquecido: { ciclosConcluidos: 2, metricas: { totalMs: { medianaMs: 1000 } } },
        qualidade: { consolidado: { f1: 0.7, precisao: 0.7, recall: 0.7, falsosPositivosPorMinuto: 1 } },
      },
    ]);
    const d = g.porVariante.find((p) => p.letra === "D");
    expect(d.totalMedianaMs).toBe(1000);
    expect(d.ciclosConcluidos).toBe(2);
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