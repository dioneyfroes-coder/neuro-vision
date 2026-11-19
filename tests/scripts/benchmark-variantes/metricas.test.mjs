import { describe, expect, it } from "vitest";

import {
  agregarEtapasIsoladas,
  agregarMetricasCiclos,
  ehCicloConcluido,
  intervaloConfiancaMediana,
  separarWarmupCiclos,
} from "../../../scripts/benchmark-variantes.mjs";
import { registro } from "../../helpers/benchmark-variantes.mjs";

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
    // Amostra insuficiente: IC da mediana e N/A, nunca inventado.
    expect(m.metricas.totalMs.intervaloConfiancaMediana).toBeNull();
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

  it("anexa IC95% da mediana quando ha pelo menos 10 amostras", () => {
    const registros = Array.from({ length: 10 }, (_, i) =>
      registro({ cycleId: `c${i + 1}`, metricas: { totalMs: 100 + i * 10 } })
    );
    const m = agregarMetricasCiclos(registros);
    expect(m.metricas.totalMs.amostras).toBe(10);
    expect(m.metricas.totalMs.intervaloConfiancaMediana).toMatchObject({
      confianca: 0.95,
      amostras: 10,
      metodo: "ordem-estatistica",
    });
  });

  it("separa inferência por snapshot, memória, carga fria e desfechos (P3.1)", () => {
    const carga = {
      totalMs: 500,
      subsistemas: {
        deteccao: {
          status: "ok",
          modelo: "yolo",
          dispositivo: "wasm",
          tempoCargaMs: 400,
        },
      },
    };
    const registros = [
      registro({
        metricas: {
          totalMs: 1000,
          percepcaoTotalMs: 600,
          latenciaAteRespostaMultimodalMs: 1200,
          latenciaEntreCiclosMs: 450,
          inferenciaPorSnapshotMs: { deteccao: 10, pose: 20 },
          memoriaMaximaBytes: 1000,
          cargaModelos: carga,
        },
      }),
      registro({
        cycleId: "c2",
        metricas: {
          totalMs: 1200,
          percepcaoTotalMs: 800,
          latenciaAteRespostaMultimodalMs: 1400,
          latenciaEntreCiclosMs: 550,
          inferenciaPorSnapshotMs: { deteccao: 30 },
          memoriaMaximaBytes: 3000,
          cargaModelos: carga,
        },
      }),
      registro({
        cycleId: "c3",
        frameIds: [],
        observacoes: 0,
        eventosTemporais: 0,
        cancelado: true,
        metricas: {},
      }),
      registro({
        cycleId: "c4",
        frameIds: [],
        observacoes: 0,
        eventosTemporais: 0,
        cancelado: false,
        concluidoEm: undefined,
        metricas: {},
      }),
    ];

    const m = agregarMetricasCiclos(registros);

    // Desfechos explicitos: um cancelado, um incompleto (sem frames/conclusao).
    expect(m.ciclosCompletos).toBe(2);
    expect(m.ciclosIncompletos).toBe(1);
    expect(m.cancelados).toBe(1);
    expect(m.ciclosComSubsistemaIndisponivel).toBe(0);

    // Latencia: mediana e P95 dos novos campos (nao apenas totalMs).
    expect(m.metricas.percepcaoTotalMs.medianaMs).toBe(700);
    expect(m.metricas.latenciaAteRespostaMultimodalMs.p95Ms).toBeCloseTo(1390, 5);
    expect(m.metricas.latenciaEntreCiclosMs.medianaMs).toBe(500);

    // Inferencia aquecida por snapshot: so subsistemas com amostra.
    expect(m.inferenciaPorSnapshot.deteccao).toMatchObject({ medianaMs: 20, amostras: 2 });
    expect(m.inferenciaPorSnapshot.pose).toMatchObject({ medianaMs: 20, amostras: 1 });
    expect(m.inferenciaPorSnapshot.maos).toBeUndefined();

    // Memoria: pico observado, nao media.
    expect(m.memoriaMaxima).toMatchObject({ medianaBytes: 2000, maximoBytes: 3000, amostras: 2 });

    // Carga fria: deduplicada por sessao (mesmo custo em todos os ciclos).
    expect(m.cargaModelos.sessoes).toBe(1);
    expect(m.cargaModelos.subsistemas.deteccao).toMatchObject({
      modelo: "yolo",
      dispositivo: "wasm",
    });
    expect(m.cargaModelos.subsistemas.deteccao.tempoCargaMs).toMatchObject({
      medianaMs: 400,
      amostras: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// Fase 4/5 — intervalo de confianca da mediana (sem inventar incerteza)
// ---------------------------------------------------------------------------

describe("intervaloConfiancaMediana", () => {
  it("devolve null quando a amostra nao basta para um IC nao trivial", () => {
    expect(intervaloConfiancaMediana([])).toBeNull();
    expect(intervaloConfiancaMediana([1, 2, 3, 4, 5])).toBeNull();
    expect(intervaloConfiancaMediana([1, 2, 3, 4, 5, 6, 7, 8, 9])).toBeNull();
  });

  it("usa ordem estatistica com pelo menos 10 amostras", () => {
    const valores = [10, 12, 14, 16, 18, 20, 22, 24, 26, 28];
    const ic = intervaloConfiancaMediana(valores);
    expect(ic).toMatchObject({
      confianca: 0.95,
      amostras: 10,
      metodo: "ordem-estatistica",
    });
    expect(ic.inferiorMs).toBeLessThanOrEqual(19);
    expect(ic.superiorMs).toBeGreaterThanOrEqual(19);
    expect(ic.inferiorMs).toBeLessThan(ic.superiorMs);
  });

  it("ignora valores nao finitos e respeita o minimo configuravel", () => {
    expect(
      intervaloConfiancaMediana([1, 2, 3, Number.NaN, 4, 5, 6], { minimoAmostras: 6 })
    ).not.toBeNull();
    expect(intervaloConfiancaMediana([1, 2, 3, Number.NaN], { minimoAmostras: 4 })).toBeNull();
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