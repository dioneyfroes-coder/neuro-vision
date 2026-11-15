import { describe, expect, it } from "vitest";
import {
  CADENCIA_TODOS_OS_FRAMES,
  intervaloDaCadencia,
  naoAmostrado,
  naoFoiAmostrado,
  planejarAmostragem,
  resumirAmostragem,
  SUBSISTEMAS_PERCEPCAO,
} from "../src/domain";

/**
 * Cadencia independente por subsistema (Fase 1.3).
 *
 * O plano e derivado apenas dos timestamps de captura — nunca da ordem de
 * conclusao do processamento — para permanecer deterministico com concorrencia.
 */
describe("planejarAmostragem", () => {
  it("sem cadencia, todos os subsistemas rodam em todos os frames", () => {
    const timestamps = [0, 500, 1000, 1500];
    const plano = planejarAmostragem(timestamps);
    expect(plano).toHaveLength(4);
    for (const frame of plano) {
      expect([...frame].sort()).toEqual([...SUBSISTEMAS_PERCEPCAO].sort());
    }
  });

  it("sempre ancora o primeiro frame com todos os subsistemas", () => {
    const plano = planejarAmostragem([0, 1000, 2000], { poseMs: 10_000, maosMs: 10_000 });
    expect([...plano[0]].sort()).toEqual([...SUBSISTEMAS_PERCEPCAO].sort());
  });

  it("amostra maos a cada 200 ms e pose/deteccao a cada 1000 ms", () => {
    // 5 frames a 200 ms -> janela de 0,8 s.
    const timestamps = [0, 200, 400, 600, 800];
    const plano = planejarAmostragem(timestamps, {
      maosMs: 200,
      poseMs: 1000,
      deteccaoMs: 1000,
    });

    expect(plano.map((frame) => frame.has("maos"))).toEqual([true, true, true, true, true]);
    expect(plano.map((frame) => frame.has("pose"))).toEqual([true, false, false, false, false]);
    expect(plano.map((frame) => frame.has("deteccao"))).toEqual([true, false, false, false, false]);
    // NSFW sem intervalo configurado roda em todos os frames.
    expect(plano.map((frame) => frame.has("nsfw"))).toEqual([true, true, true, true, true]);
  });

  it("com intervalos maiores, respeita os multiplos do alvo", () => {
    // Frames a 250 ms: pose (1000 ms) cai nos frames 0 (0 ms) e 4 (1000 ms).
    const timestamps = [0, 250, 500, 750, 1000, 1250];
    const plano = planejarAmostragem(timestamps, { poseMs: 1000 });
    expect(plano.map((frame) => frame.has("pose"))).toEqual([
      true,
      false,
      false,
      false,
      true,
      false,
    ]);
  });

  it("absorve jitter de captura dentro da tolerancia", () => {
    // Capturas um pouco antes/ depois do alvo de 200 ms continuam amostrando.
    const plano = planejarAmostragem([0, 215, 390, 615, 790], { maosMs: 200 });
    expect(plano.map((frame) => frame.has("maos"))).toEqual([true, true, true, true, true]);
  });

  it("nao depende da ordem de conclusao (funcao pura dos timestamps)", () => {
    const timestamps = [0, 200, 400, 600, 800];
    const cadencia = { maosMs: 200, poseMs: 1000 };
    const a = planejarAmostragem(timestamps, cadencia);
    const b = planejarAmostragem(timestamps, cadencia);
    expect(a.map((frame) => [...frame].sort())).toEqual(b.map((frame) => [...frame].sort()));
  });

  it("timestamps nao finitos herdam o instante anterior sem quebrar", () => {
    const plano = planejarAmostragem([0, 200, Number.NaN, 600], { maosMs: 200 });
    expect(plano).toHaveLength(4);
    // O frame NaN herda 200 ms: nao alcanca o alvo de 400 ms...
    expect(plano[2].has("maos")).toBe(false);
    // ...e o frame seguinte (600 ms) volta a amostrar normalmente.
    expect(plano[3].has("maos")).toBe(true);
  });

  it("devolve lista vazia para lista de timestamps vazia", () => {
    expect(planejarAmostragem([], { maosMs: 200 })).toEqual([]);
  });

  it("intervalos invalidos (<= 0) equivalem a todo frame", () => {
    expect(intervaloDaCadencia({ maosMs: 0 }, "maos")).toBeUndefined();
    expect(intervaloDaCadencia({ maosMs: -5 }, "maos")).toBeUndefined();
    expect(intervaloDaCadencia(undefined, "maos")).toBeUndefined();
    const plano = planejarAmostragem([0, 200, 400], { maosMs: 0 });
    expect(plano.every((frame) => frame.has("maos"))).toBe(true);
  });

  it("CADENCIA_TODOS_OS_FRAMES nao configura nenhum intervalo", () => {
    expect(CADENCIA_TODOS_OS_FRAMES).toEqual({});
  });
});

describe("resumirAmostragem", () => {
  const timestamps = [0, 200, 400, 600, 800];
  const cadencia = { maosMs: 200, poseMs: 1000, deteccaoMs: 1000 };

  it("conta amostras, calcula FPS efetivo e preserva o alvo", () => {
    const plano = planejarAmostragem(timestamps, cadencia);
    const resumo = resumirAmostragem(timestamps, plano, cadencia);

    expect(resumo.janelaMs).toBe(800);
    expect(resumo.porSubsistema.maos).toEqual({
      amostrados: 5,
      intervaloAlvoMs: 200,
      intervaloMedioMs: 200,
      fpsEfetivo: 5,
    });
    expect(resumo.porSubsistema.pose).toEqual({
      amostrados: 1,
      intervaloAlvoMs: 1000,
    });
    // Sem intervalo configurado, a metrica nao inventa alvo.
    expect(resumo.porSubsistema.nsfw?.amostrados).toBe(5);
    expect(resumo.porSubsistema.nsfw?.intervaloAlvoMs).toBeUndefined();
  });

  it("nao deriva FPS com menos de duas amostras", () => {
    const plano = planejarAmostragem([0, 100], { poseMs: 5000 });
    const resumo = resumirAmostragem([0, 100], plano, { poseMs: 5000 });
    expect(resumo.porSubsistema.pose?.amostrados).toBe(1);
    expect(resumo.porSubsistema.pose?.fpsEfetivo).toBeUndefined();
  });
});

describe("naoAmostrado", () => {
  it("e indistinguivel de indisponivel para `estaIndisponivel`, mas nao para a guarda propria", () => {
    const pulado = naoAmostrado("maos");
    expect(pulado).toMatchObject({
      indisponivel: true,
      subsistema: "maos",
      naoAmostrado: true,
    });
    expect(naoFoiAmostrado(pulado)).toBe(true);

    const falha = { indisponivel: true as const, subsistema: "maos" as const, motivo: "erro" };
    expect(naoFoiAmostrado(falha)).toBe(false);
    expect(naoFoiAmostrado({ maos: [] })).toBe(false);
    expect(naoFoiAmostrado(undefined)).toBe(false);
  });
});
