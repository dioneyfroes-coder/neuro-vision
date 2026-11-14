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

  it("corrige a anisotropia quando recebe a escala do frame", () => {
    const b = { x: 0, y: 0 };
    const a = { x: 1, y: 0 };
    const rad = (140 * Math.PI) / 180;
    const c = { x: Math.cos(rad), y: Math.sin(rad) };
    // Sem dimensoes, o angulo e medido em coordenadas normalizadas (1:1).
    expect(anguloInterno(a, b, c)).toBeCloseTo(140, 1);
    // Em 16:9, x e y tem escalas fisicas diferentes; o angulo real e maior.
    expect(anguloInterno(a, b, c, { x: 1600, y: 900 })).toBeCloseTo(154.7, 1);
    // Escala quadrada preserva o angulo normalizado.
    expect(anguloInterno(a, b, c, { x: 100, y: 100 })).toBeCloseTo(140, 1);
  });

  it("nao inventa angulo quando os pontos coincidem", () => {
    expect(anguloInterno({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeNull();
  });
});

/**
 * Indicador com o angulo proximal de ~140 em coordenadas normalizadas.
 *
 * Em um frame 16:9 o mesmo angulo, medido em pixels, passa de ~154: a mao
 * parece "dobrada" apenas por causa da anisotropia entre x e y. Este e o caso
 * que a correcao precisa resolver.
 */
function maoComIndicadorEmAnguloNormalizado(): LandmarkMao[] {
  const landmarks = maoEstendida();
  const passo = 0.1;
  // Angulo de 140 graus no pip: o vetor para o mcp aponta para (-1, 0), entao
  // o vetor para o dip precisa estar a 40 graus do eixo +x.
  const direcao = Math.PI - (140 * Math.PI) / 180;
  const dx = passo * Math.cos(direcao);
  const dy = passo * Math.sin(direcao);
  landmarks[5] = { x: 0.4, y: 0.5 };
  landmarks[6] = { x: 0.5, y: 0.5 };
  landmarks[7] = { x: landmarks[6].x + dx, y: landmarks[6].y + dy };
  landmarks[8] = { x: landmarks[7].x + dx, y: landmarks[7].y + dy };
  return landmarks;
}

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

  it("corrige a anisotropia das dimensoes e registra que o fez", () => {
    const landmarks = maoComIndicadorEmAnguloNormalizado();
    const semDimensoes = calcularGeometriaMao(landmarks);
    const comDimensoes = calcularGeometriaMao(landmarks, {
      dimensoes: { largura: 1600, altura: 900 },
    });
    const quadrada = calcularGeometriaMao(landmarks, {
      dimensoes: { largura: 100, altura: 100 },
    });
    const indicador = (geometria: NonNullable<typeof semDimensoes>) =>
      geometria.dedos.find((d) => d.nome === "indicador");

    expect(semDimensoes!.aspectoCorrigido).toBe(false);
    expect(comDimensoes!.aspectoCorrigido).toBe(true);
    expect(quadrada!.aspectoCorrigido).toBe(true);

    // Normalizado por eixo: o indicador parece dobrado.
    expect(indicador(semDimensoes!)?.estado).toBe("dobrado");
    expect(semDimensoes!.totalEstendidos).toBe(4);
    // Com pixels reais (16:9), o angulo cruza o limiar e o dedo fica estendido.
    expect(indicador(comDimensoes!)?.angulos[0]).toBeGreaterThan(150);
    expect(indicador(comDimensoes!)?.estado).toBe("estendido");
    expect(comDimensoes!.totalEstendidos).toBe(5);
    // Escala quadrada nao altera o angulo normalizado.
    expect(indicador(quadrada!)?.angulos).toEqual(indicador(semDimensoes!)?.angulos);
  });

  it("nao aplica correcao com dimensoes invalidas", () => {
    for (const dimensoes of [
      { largura: 0, altura: 900 },
      { largura: 1600, altura: -1 },
      { largura: Number.NaN, altura: 900 },
    ]) {
      const geometria = calcularGeometriaMao(maoEstendida(), { dimensoes });
      expect(geometria!.aspectoCorrigido).toBe(false);
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
