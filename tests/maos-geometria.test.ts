import { describe, expect, it } from "vitest";
import type { LandmarkMao } from "../src/domain";
import {
  anguloInterno,
  calcularGeometriaMao,
  configurarDedos,
  LIMIAR_EXTENSAO_PADRAO_GRAUS,
} from "../src/domain/hand-geometry";

/**
 * P2.1 — features geometricas da mao.
 *
 * O Gesture Recognizer cobre apenas classes predefinidas. Estes testes fixam a
 * derivacao de angulos articulares e do estado estendido/dobrado por dedo, que
 * alimentam o contexto multimodal independentemente do rotulo do classificador.
 */

/** 21 landmarks com todos os dedos retos (na vertical). */
function maoEstendida(): LandmarkMao[] {
  const landmarks: LandmarkMao[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }));
  landmarks[0] = { x: 0.5, y: 0.9 };
  // Polegar: cmc(1) -> mcp(2) -> ip(3) -> ponta(4), em linha reta.
  landmarks[1] = { x: 0.4, y: 0.75 };
  landmarks[2] = { x: 0.35, y: 0.65 };
  landmarks[3] = { x: 0.3, y: 0.55 };
  landmarks[4] = { x: 0.25, y: 0.45 };
  const dedos = [
    { mcp: 5, pip: 6, dip: 7, tip: 8, x: 0.38 },
    { mcp: 9, pip: 10, dip: 11, tip: 12, x: 0.46 },
    { mcp: 13, pip: 14, dip: 15, tip: 16, x: 0.54 },
    { mcp: 17, pip: 18, dip: 19, tip: 20, x: 0.62 },
  ];
  for (const { mcp, pip, dip, tip, x } of dedos) {
    landmarks[mcp] = { x, y: 0.6 };
    landmarks[pip] = { x, y: 0.48 };
    landmarks[dip] = { x, y: 0.36 };
    landmarks[tip] = { x, y: 0.24 };
  }
  return landmarks;
}

/** Mesma mao, mas com todos os dedos dobrados (falange distal voltando). */
function maoFechada(): LandmarkMao[] {
  const landmarks = maoEstendida();
  const dedos = [
    { pip: 6, dip: 7, tip: 8, x: 0.38 },
    { pip: 10, dip: 11, tip: 12, x: 0.46 },
    { pip: 14, dip: 15, tip: 16, x: 0.54 },
    { pip: 18, dip: 19, tip: 20, x: 0.62 },
  ];
  for (const { pip, dip, tip, x } of dedos) {
    landmarks[pip] = { x, y: 0.52 };
    landmarks[dip] = { x, y: 0.6 };
    landmarks[tip] = { x, y: 0.68 };
  }
  // Polegar dobrado: ip e ponta voltam para baixo.
  landmarks[2] = { x: 0.35, y: 0.7 };
  landmarks[3] = { x: 0.4, y: 0.65 };
  landmarks[4] = { x: 0.35, y: 0.6 };
  return landmarks;
}

describe("anguloInterno", () => {
  it("mede angulos retos e rasos em graus", () => {
    const b = { x: 0, y: 0 };
    expect(anguloInterno({ x: 1, y: 0 }, b, { x: 0, y: 1 })).toBeCloseTo(90);
    expect(anguloInterno({ x: -1, y: 0 }, b, { x: 1, y: 0 })).toBeCloseTo(180);
    expect(anguloInterno({ x: 1, y: 0 }, b, { x: 1, y: 0 })).toBeCloseTo(0);
  });

  it("nao inventa angulo quando os pontos coincidem", () => {
    expect(anguloInterno({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeNull();
  });
});

describe("calcularGeometriaMao", () => {
  it("reconhece todos os dedos estendidos sem depender do rotulo do gesto", () => {
    const geometria = calcularGeometriaMao(maoEstendida());
    expect(geometria).not.toBeNull();
    expect(geometria!.dedos.map((d) => d.nome)).toEqual([
      "polegar",
      "indicador",
      "medio",
      "anular",
      "mindinho",
    ]);
    expect(geometria!.totalEstendidos).toBe(5);
    expect(geometria!.dedosEstendidos).toEqual([
      "polegar",
      "indicador",
      "medio",
      "anular",
      "mindinho",
    ]);
    expect(geometria!.configuracao).toBe("todos");
    expect(geometria!.limiarExtensaoGraus).toBe(LIMIAR_EXTENSAO_PADRAO_GRAUS);
    // Dedo reto: articulacoes proximais e distais proximas de 180 graus.
    for (const dedo of geometria!.dedos) {
      expect(dedo.angulos).toHaveLength(2);
      for (const angulo of dedo.angulos) expect(angulo).toBeGreaterThan(170);
    }
  });

  it("reconhece mao fechada (todos os dedos dobrados)", () => {
    const geometria = calcularGeometriaMao(maoFechada());
    expect(geometria).not.toBeNull();
    expect(geometria!.totalEstendidos).toBe(0);
    expect(geometria!.dedosEstendidos).toEqual([]);
    expect(geometria!.configuracao).toBe("nenhum");
    expect(geometria!.dedos.some((d) => d.estendido)).toBe(false);
  });

  it("distingue configuracoes parciais (so o indicador estendido)", () => {
    const landmarks = maoFechada();
    const indicador = maoEstendida();
    for (const indice of [5, 6, 7, 8]) landmarks[indice] = indicador[indice];
    const geometria = calcularGeometriaMao(landmarks);
    expect(geometria!.dedosEstendidos).toEqual(["indicador"]);
    expect(geometria!.totalEstendidos).toBe(1);
    expect(geometria!.configuracao).toBe("indicador");
  });

  it("respeita o limiar de extensao e as casas decimais", () => {
    const geometria = calcularGeometriaMao(maoEstendida(), {
      limiarExtensaoGraus: 179,
      decimais: 0,
    });
    // Angulos ~180 continuam acima de 179, mas sao arredondados para inteiro.
    expect(geometria!.totalEstendidos).toBe(5);
    expect(geometria!.dedos[0].angulos.every((a) => Number.isInteger(a))).toBe(true);

    const exigente = calcularGeometriaMao(maoEstendida(), { limiarExtensaoGraus: 181 });
    expect(exigente!.totalEstendidos).toBe(0);
  });

  it("mantem os cinco dedos e marca como desconhecido o que falta", () => {
    const landmarks = maoEstendida();
    landmarks[7] = { x: Number.NaN, y: 0.5 };
    const geometria = calcularGeometriaMao(landmarks);
    // Representacao estavel: os cinco dedos continuam presentes na ordem.
    expect(geometria!.dedos.map((d) => d.nome)).toEqual([
      "polegar",
      "indicador",
      "medio",
      "anular",
      "mindinho",
    ]);
    const indicador = geometria!.dedos.find((d) => d.nome === "indicador");
    expect(indicador?.estado).toBe("desconhecido");
    expect(indicador?.estendido).toBe(false);
    expect(indicador?.angulos).toEqual([]);
    expect(geometria!.dedosDesconhecidos).toEqual(["indicador"]);
    expect(geometria!.totalDedosConhecidos).toBe(4);
    expect(geometria!.totalEstendidos).toBe(4);
    // Mao parcial nao vira "todos": o total de referencia continua sendo 5.
    expect(geometria!.configuracao).toBe("polegar+medio+anular+mindinho");
    expect(calcularGeometriaMao([])).toBeNull();
  });
});

describe("configurarDedos", () => {
  it("resume todos/nenhum/lista", () => {
    expect(configurarDedos([])).toBe("nenhum");
    expect(configurarDedos(["polegar", "indicador", "medio", "anular", "mindinho"])).toBe(
      "todos"
    );
    expect(configurarDedos(["indicador", "medio"])).toBe("indicador+medio");
  });
});
