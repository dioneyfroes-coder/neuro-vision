import { describe, expect, it } from "vitest";
import type { LandmarkMao, NomeDedo } from "../src/domain";
import {
  calcularGeometriaMao,
  resumirGeometria,
  type GeometriaDedo,
  type GeometriaMao,
} from "../src/domain/hand-geometry";
import {
  classificarGestoGeometrico,
  combinarGesto,
  estabilizarDedos,
  estadosDosDedos,
  type EstadoDedos,
} from "../src/domain/hand-gestures";

/**
 * P2.3/P2.4/P2.5 — representacao dos cinco dedos, regras iniciais de gesto e
 * histerese. Nenhum teste trata a heuristica como certeza: a confianca e
 * sempre limitada e o conflito com o modelo e explicito.
 */

const NOMES: NomeDedo[] = ["polegar", "indicador", "medio", "anular", "mindinho"];

function maoEstendida(): LandmarkMao[] {
  const landmarks: LandmarkMao[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }));
  landmarks[0] = { x: 0.5, y: 0.9 };
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
  landmarks[2] = { x: 0.35, y: 0.7 };
  landmarks[3] = { x: 0.4, y: 0.65 };
  landmarks[4] = { x: 0.35, y: 0.6 };
  return landmarks;
}

function abrirDedo(landmarks: LandmarkMao[], indices: number[]) {
  const aberta = maoEstendida();
  for (const indice of indices) landmarks[indice] = aberta[indice];
}

function geometriaDe(landmarks: LandmarkMao[]): GeometriaMao {
  const geometria = calcularGeometriaMao(landmarks);
  if (!geometria) throw new Error("geometria esperada");
  return geometria;
}

describe("classificarGestoGeometrico", () => {
  it("reconhece mao aberta e punho fechado", () => {
    expect(classificarGestoGeometrico(geometriaDe(maoEstendida())).nome).toBe("mao_aberta");
    expect(classificarGestoGeometrico(geometriaDe(maoFechada())).nome).toBe("punho_fechado");
  });

  it("reconhece um dedo e dois dedos", () => {
    const um = maoFechada();
    abrirDedo(um, [5, 6, 7, 8]);
    expect(classificarGestoGeometrico(geometriaDe(um)).nome).toBe("um_dedo");

    const dois = maoFechada();
    abrirDedo(dois, [5, 6, 7, 8, 9, 10, 11, 12]);
    expect(classificarGestoGeometrico(geometriaDe(dois)).nome).toBe("dois_dedos");
  });

  it("reconhece polegar para cima pela orientacao, antes de 'um dedo'", () => {
    const polegar = maoFechada();
    abrirDedo(polegar, [1, 2, 3, 4]);
    const classificacao = classificarGestoGeometrico(geometriaDe(polegar), polegar);
    expect(classificacao.nome).toBe("polegar_para_cima");
    expect(classificacao.evidencias).toContain("polegar:vertical");
  });

  it("nao fecha a mao quando falta evidencia de um dedo", () => {
    const fechada = maoFechada();
    fechada[10] = { x: Number.NaN, y: 0.5 };
    const geometria = geometriaDe(fechada);
    expect(geometria.dedosDesconhecidos).toEqual(["medio"]);
    // 0 estendidos, mas so 4 conhecidos: nao vira "punho_fechado".
    expect(classificarGestoGeometrico(geometria).nome).toBeNull();
  });

  it("confianca e heuristica limitada (nunca 1)", () => {
    const classificacao = classificarGestoGeometrico(geometriaDe(maoEstendida()));
    expect(classificacao.confianca).toBeGreaterThan(0.5);
    expect(classificacao.confianca).toBeLessThanOrEqual(0.9);
  });
});

describe("combinarGesto", () => {
  const aberta = classificarGestoGeometrico(geometriaDe(maoEstendida()));

  it("preserva as duas evidencias quando modelo e geometria concordam", () => {
    const r = combinarGesto("mao_aberta", 0.9, aberta);
    expect(r.rotulo).toBe("mao_aberta");
    expect(r.evidencias.some((e) => e.includes("mediapipe:mao_aberta"))).toBe(true);
    expect(r.evidencias.some((e) => e.includes("geometria:todos"))).toBe(true);
    expect(r.confianca).toBeLessThanOrEqual(0.95);
  });

  it("reduz a confianca e registra conflito quando as fontes discordam", () => {
    const r = combinarGesto("punho_fechado", 0.9, aberta);
    expect(r.evidencias.some((e) => e.includes("conflito:"))).toBe(true);
    expect(r.confianca).toBeLessThan(0.9);
  });
});

describe("estabilizarDedos", () => {
  function geometriaComAngulo(angulo: number): GeometriaMao {
    const dedos: GeometriaDedo[] = NOMES.map((nome) => ({
      nome,
      angulos: [angulo, angulo],
      estendido: angulo >= 150,
      estado: angulo >= 150 ? "estendido" : "dobrado",
    }));
    return resumirGeometria(dedos, 150);
  }

  it("mantem o dedo estendido na faixa de histerese", () => {
    const atual = geometriaComAngulo(145);
    const anterior: EstadoDedos = {
      polegar: "estendido",
      indicador: "estendido",
      medio: "estendido",
      anular: "estendido",
      mindinho: "estendido",
    };
    const estabilizada = estabilizarDedos(atual, anterior, 10);
    // 145 < 150 (entrada), mas >= 140 (permanencia do estado estendido).
    expect(estabilizada.totalEstendidos).toBe(5);
    expect(estabilizada.dedos.every((d) => d.estado === "estendido")).toBe(true);
  });

  it("nao entra em estendido apenas por estar proximo do limiar", () => {
    const atual = geometriaComAngulo(145);
    const estabilizada = estabilizarDedos(atual, undefined, 10);
    expect(estabilizada.totalEstendidos).toBe(0);
    expect(estabilizada.dedos.every((d) => d.estado === "dobrado")).toBe(true);
  });

  it("preserva dedo desconhecido sem inventar estado", () => {
    const aberta = maoEstendida();
    aberta[10] = { x: Number.NaN, y: 0.5 };
    const geometria = geometriaDe(aberta);
    const estabilizada = estabilizarDedos(geometria, estadosDosDedos(geometria), 10);
    const medio = estabilizada.dedos.find((d) => d.nome === "medio");
    expect(medio?.estado).toBe("desconhecido");
  });
});
