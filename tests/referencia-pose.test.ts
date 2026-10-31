import { describe, expect, it } from "vitest";
import type { PontoCorporal } from "../src/domain";
import {
  centroidePontos,
  pontoReferenciaPose,
} from "../public/temporal/referencia-pose";

/**
 * P2.2 — referencia estavel de pose.
 *
 * O rastreamento nao deve depender do centroide de todos os keypoints: bracos,
 * cabeca e pernas mudam de posicao sem a pessoa se deslocar. Estes testes fixam
 * a prioridade torso -> ombros -> quadris -> centroide.
 */

/** 17 keypoints COCO com torso fixo e o restante deslocavel. */
function pose(opcoes: {
  ombros?: number;
  quadris?: number;
  outros?: number;
  confiancaOmbros?: number;
} = {}): PontoCorporal[] {
  const { ombros = 0.4, quadris = 0.6, outros = 0.2, confiancaOmbros = 0.9 } = opcoes;
  const pontos: PontoCorporal[] = Array.from({ length: 17 }, () => ({
    x: 0.5,
    y: outros,
    confianca: 0.9,
  }));
  pontos[5] = { x: 0.45, y: ombros, confianca: confiancaOmbros };
  pontos[6] = { x: 0.55, y: ombros, confianca: confiancaOmbros };
  pontos[11] = { x: 0.45, y: quadris, confianca: 0.9 };
  pontos[12] = { x: 0.55, y: quadris, confianca: 0.9 };
  return pontos;
}

describe("pontoReferenciaPose", () => {
  it("usa o torso (ombros + quadris) e ignora bracos/pernas/cabeca", () => {
    const bracosBaixos = pontoReferenciaPose(pose({ outros: 0.8 }));
    const bracosAltos = pontoReferenciaPose(pose({ outros: 0.1 }));
    expect(bracosBaixos).not.toBeNull();
    expect(bracosBaixos!.fonte).toBe("torso");
    // Torso fixo: a referencia nao muda com a postura dos membros.
    expect(bracosAltos!.x).toBeCloseTo(bracosBaixos!.x);
    expect(bracosAltos!.y).toBeCloseTo(bracosBaixos!.y);
    // Media do ponto medio dos ombros (0.5, 0.4) com o dos quadris (0.5, 0.6).
    expect(bracosBaixos!.x).toBeCloseTo(0.5);
    expect(bracosBaixos!.y).toBeCloseTo(0.5);
  });

  it("cai para os ombros quando os quadris sao invalidos", () => {
    const pontos = pose();
    pontos[11] = { x: 0.45, y: 0.6, confianca: 0.01 };
    pontos[12] = { x: 0.55, y: 0.6, confianca: 0.01 };
    const ref = pontoReferenciaPose(pontos);
    expect(ref!.fonte).toBe("ombros");
    expect(ref!.y).toBeCloseTo(0.4);
  });

  it("cai para os quadris quando os ombros sao invalidos", () => {
    const pontos = pose({ confiancaOmbros: 0.01 });
    const ref = pontoReferenciaPose(pontos);
    expect(ref!.fonte).toBe("quadris");
    expect(ref!.y).toBeCloseTo(0.6);
  });

  it("usa o centroide apenas como ultimo recurso", () => {
    const pontos = pose({ confiancaOmbros: 0.01 });
    pontos[11] = { x: 0.45, y: 0.6, confianca: 0.01 };
    pontos[12] = { x: 0.55, y: 0.6, confianca: 0.01 };
    // Todos os pontos validos estao em y=0.2 (o torso perdeu confianca).
    const ref = pontoReferenciaPose(pontos);
    expect(ref!.fonte).toBe("centroide");
    expect(ref!.y).toBeCloseTo(0.2);
  });

  it("retorna null sem pontos validos", () => {
    expect(pontoReferenciaPose([])).toBeNull();
    expect(
      pontoReferenciaPose([{ x: Number.NaN, y: 0.5, confianca: 0.9 }])
    ).toBeNull();
    expect(centroidePontos([])).toBeNull();
  });

  it("nao deixa um unico keypoint invalido deslocar o torso", () => {
    const base = pontoReferenciaPose(pose())!;
    const pontos = pose();
    pontos[5] = { x: 0.1, y: 0.1, confianca: 0.01 }; // ombro esquerdo oculto
    const ref = pontoReferenciaPose(pontos)!;
    // Sem o par de ombros completo, a referencia cai para os quadris (estaveis).
    expect(ref.fonte).toBe("quadris");
    expect(ref.x).toBeCloseTo(base.x);
    expect(ref.y).toBeCloseTo(0.6);
  });
});
