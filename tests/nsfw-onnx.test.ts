import { describe, expect, it } from "vitest";
import {
  CLASSES_NUDENET,
  LIMIARES_NSFW,
  MODELO_NSFW_PADRAO,
  MODELOS_NSFW,
  definicaoModeloNsfw,
  filtrarDeteccoesNsfw,
  interpretarSaidaNudeNetCru,
  limiarEfetivoNsfw,
  limiarMinimoNsfw,
  nmsPorRotulo,
  urlModeloNsfw,
} from "../public/nsfw-onnx";
import type { DeteccaoYOLO } from "../public/yolo-onnx";

/** Indice da classe no catalogo NudeNet v3.4. */
function classe(nome: string): number {
  const indice = CLASSES_NUDENET.indexOf(nome as (typeof CLASSES_NUDENET)[number]);
  if (indice < 0) throw new Error(`classe desconhecida: ${nome}`);
  return indice;
}

/**
 * Monta a saida crua `[1, 22, N]` (transposta) a partir de linhas logicas:
 * `{ cx, cy, w, h, scores: { CLASSE: valor } }`.
 */
function saidaCruaTransposta(
  linhas: ReadonlyArray<{
    cx: number;
    cy: number;
    w: number;
    h: number;
    scores: Record<string, number>;
  }>
): Float32Array {
  const n = linhas.length;
  const dados = new Float32Array(22 * n);
  linhas.forEach((linha, i) => {
    dados[0 * n + i] = linha.cx;
    dados[1 * n + i] = linha.cy;
    dados[2 * n + i] = linha.w;
    dados[3 * n + i] = linha.h;
    for (const [nome, valor] of Object.entries(linha.scores)) {
      dados[(4 + classe(nome)) * n + i] = valor;
    }
  });
  return dados;
}

/** Mesma saida na forma nao transposta `[1, N, 22]`. */
function transporParaLinhas(cru: Float32Array, n: number): Float32Array {
  const dados = new Float32Array(22 * n);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 22; c++) dados[i * 22 + c] = cru[c * n + i];
  }
  return dados;
}

function deteccao(label: string, score: number, caixa = { xmin: 0, ymin: 0, xmax: 10, ymax: 10 }): DeteccaoYOLO {
  return { label, score, box: { ...caixa } };
}

describe("interpretarSaidaNudeNetCru", () => {
  // lado 320 -> frame 640x480: ex = 2, ey = 1.5
  const lado = 320;
  const largura = 640;
  const altura = 480;

  const duasLinhas = [
    {
      cx: 160,
      cy: 160,
      w: 40,
      h: 40,
      scores: { MALE_GENITALIA_EXPOSED: 0.66 },
    },
    {
      cx: 80,
      cy: 80,
      w: 20,
      h: 20,
      scores: { FEMALE_GENITALIA_COVERED: 0.16 },
    },
  ];

  it("decodifica a saida crua transposta [1, 22, N]", () => {
    const cru = saidaCruaTransposta(duasLinhas);
    const deteccoes = interpretarSaidaNudeNetCru(cru, [1, 22, 2], 0.5, largura, altura, lado);
    expect(deteccoes).toHaveLength(2);
    const penis = deteccoes.find((d) => d.label === "MALE_GENITALIA_EXPOSED");
    expect(penis?.score).toBeCloseTo(0.66, 5);
    expect(penis?.box).toEqual({ xmin: 280, ymin: 210, xmax: 360, ymax: 270 });
  });

  it("entende a forma nao transposta [1, N, 22]", () => {
    const cru = transporParaLinhas(saidaCruaTransposta(duasLinhas), 2);
    const deteccoes = interpretarSaidaNudeNetCru(cru, [1, 2, 22], 0.5, largura, altura, lado);
    expect(deteccoes.map((d) => d.label).sort()).toEqual([
      "FEMALE_GENITALIA_COVERED",
      "MALE_GENITALIA_EXPOSED",
    ]);
  });

  it("usa limiar por classe, nao o limiar global", () => {
    const cru = saidaCruaTransposta(duasLinhas);
    // Genital coberto a 0,16 passa no piso de 0,15 mesmo com global 0,5.
    const deteccoes = interpretarSaidaNudeNetCru(cru, [1, 22, 2], 0.5, largura, altura, lado);
    expect(deteccoes.some((d) => d.label === "FEMALE_GENITALIA_COVERED")).toBe(true);
  });

  it("descarta score abaixo do piso da propria classe", () => {
    const cru = saidaCruaTransposta([
      { cx: 80, cy: 80, w: 20, h: 20, scores: { FEMALE_GENITALIA_COVERED: 0.1 } },
    ]);
    expect(interpretarSaidaNudeNetCru(cru, [1, 22, 1], 0.5, largura, altura, lado)).toHaveLength(0);
  });

  it("aplica sigmoid quando os scores nao estao em [0,1]", () => {
    const cru = saidaCruaTransposta([
      { cx: 160, cy: 160, w: 40, h: 40, scores: { MALE_GENITALIA_EXPOSED: 5 } },
    ]);
    const [d] = interpretarSaidaNudeNetCru(cru, [1, 22, 1], 0.5, largura, altura, lado);
    expect(d.score).toBeGreaterThan(0.9);
    expect(d.score).toBeLessThanOrEqual(1);
  });

  it("nao deixa um residuo float32 negativo disparar sigmoid e criar um 0,5 falso", () => {
    // Probabilidades reais do NudeNet saem em [0,1], mas float32 pode gerar
    // -5.96e-8. Sem tolerancia, sigmoid(0)=0,5 marcaria FACE_MALE numa imagem
    // que nao tem rosto masculino.
    const cru = saidaCruaTransposta([
      { cx: 160, cy: 160, w: 40, h: 40, scores: { FACE_MALE: 1e-3 } },
    ]);
    cru[4 + classe("FACE_MALE")] = -5.96e-8;
    expect(interpretarSaidaNudeNetCru(cru, [1, 22, 1], 0.5, largura, altura, lado)).toHaveLength(0);
  });

  it("decide o sigmoid pelo tensor inteiro, nao por linha", () => {
    // Uma linha com logit real (5) forca o sigmoid para todas as linhas; a linha
    // de probabilidade 0,1 vira sigmoid(0,1) ~ 0,525 e passa no piso de 0,5.
    const cru = saidaCruaTransposta([
      { cx: 160, cy: 160, w: 40, h: 40, scores: { MALE_GENITALIA_EXPOSED: 5 } },
      { cx: 80, cy: 80, w: 20, h: 20, scores: { FEMALE_BREAST_EXPOSED: 0.1 } },
    ]);
    const deteccoes = interpretarSaidaNudeNetCru(cru, [1, 22, 2], 0.5, largura, altura, lado);
    expect(deteccoes.some((d) => d.label === "FEMALE_BREAST_EXPOSED")).toBe(true);
  });

  it("aplica NMS por classe na saida crua", () => {
    const cru = saidaCruaTransposta([
      { cx: 160, cy: 160, w: 40, h: 40, scores: { MALE_GENITALIA_EXPOSED: 0.9 } },
      { cx: 162, cy: 162, w: 40, h: 40, scores: { MALE_GENITALIA_EXPOSED: 0.8 } },
      { cx: 160, cy: 160, w: 40, h: 40, scores: { FEMALE_GENITALIA_EXPOSED: 0.7 } },
    ]);
    const deteccoes = interpretarSaidaNudeNetCru(cru, [1, 22, 3], 0.5, largura, altura, lado);
    expect(deteccoes.filter((d) => d.label === "MALE_GENITALIA_EXPOSED")).toHaveLength(1);
    expect(deteccoes.filter((d) => d.label === "FEMALE_GENITALIA_EXPOSED")).toHaveLength(1);
  });

  it("lanca para dims invalidos", () => {
    expect(() => interpretarSaidaNudeNetCru(new Float32Array(4), [1], 0.5, 10, 10, lado)).toThrow();
  });
});

describe("nmsPorRotulo", () => {
  it("suprime caixas sobrepostas da mesma classe e preserva classes distintas", () => {
    const caixa = { xmin: 0, ymin: 0, xmax: 100, ymax: 100 };
    const deteccoes = nmsPorRotulo([
      deteccao("penis", 0.9, caixa),
      deteccao("penis", 0.8, caixa),
      deteccao("vagina", 0.7, caixa),
    ]);
    expect(deteccoes.filter((d) => d.label === "penis")).toHaveLength(1);
    expect(deteccoes.filter((d) => d.label === "vagina")).toHaveLength(1);
    expect(deteccoes[0].score).toBeGreaterThanOrEqual(deteccoes[1].score);
  });

  it("mantem caixas sem sobreposicao relevante", () => {
    const deteccoes = nmsPorRotulo([
      deteccao("penis", 0.9, { xmin: 0, ymin: 0, xmax: 10, ymax: 10 }),
      deteccao("penis", 0.8, { xmin: 100, ymin: 100, xmax: 110, ymax: 110 }),
    ]);
    expect(deteccoes).toHaveLength(2);
  });
});

describe("filtrarDeteccoesNsfw", () => {
  it("aplica o piso por rotulo e cai no global para rotulos sem piso", () => {
    const deteccoes = [
      deteccao("penis", 0.3),
      deteccao("penis", 0.1),
      deteccao("MALE_GENITALIA_EXPOSED", 0.21),
      deteccao("FEMALE_GENITALIA_COVERED", 0.16),
      deteccao("classe_desconhecida", 0.4),
      deteccao("classe_desconhecida", 0.6),
    ];
    const filtradas = filtrarDeteccoesNsfw(deteccoes, 0.5);
    expect(filtradas.map((d) => `${d.label}:${d.score}`)).toEqual([
      "penis:0.3",
      "MALE_GENITALIA_EXPOSED:0.21",
      "FEMALE_GENITALIA_COVERED:0.16",
      "classe_desconhecida:0.6",
    ]);
  });
});

describe("catalogo NSFW", () => {
  it("usa o NudeNet 320n como padrao (mais rapido e com genitalia masculina)", () => {
    expect(MODELO_NSFW_PADRAO).toBe("nudenet_320n");
    expect(definicaoModeloNsfw(undefined).formato).toBe("cru");
    expect(definicaoModeloNsfw(undefined).lado).toBe(320);
  });

  it("mantem o EraX nano no catalogo com saida NMS e lado 640", () => {
    expect(MODELOS_NSFW.erax_nsfw_yolo11n).toMatchObject({ lado: 640, formato: "nms" });
  });

  it("declara NudeNet 320n com saida crua e lado 320", () => {
    expect(MODELOS_NSFW.nudenet_320n).toMatchObject({ lado: 320, formato: "cru" });
    expect(definicaoModeloNsfw("nudenet_320n").classes).toEqual(CLASSES_NUDENET);
  });

  it("resolve a URL servida localmente e aceita URL direta", () => {
    expect(urlModeloNsfw("nudenet_640m")).toBe("/yolonsfw/nudenet_640m.onnx");
    expect(urlModeloNsfw("erax_nsfw_yolo11s")).toBe("/yolonsfw/erax_nsfw_yolo11s.onnx");
    expect(urlModeloNsfw("https://exemplo/modelo.onnx")).toBe("https://exemplo/modelo.onnx");
  });

  it("expoe pisos por classe e o menor limiar utilizavel", () => {
    expect(limiarEfetivoNsfw("penis", 0.5)).toBe(LIMIARES_NSFW.penis);
    expect(limiarEfetivoNsfw("rotulo_sem_piso", 0.5)).toBe(0.5);
    expect(limiarMinimoNsfw(0.5)).toBe(0.15);
  });
});
