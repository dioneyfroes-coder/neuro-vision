import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  interpretarLinhasYoloPose,
  KEYPOINTS_POR_PESSOA,
  LIMIAR_SCORE_POSE,
} from "../public/perception/yolo-pose-output";

interface FixtureYoloPose {
  modelo: string;
  sha256Modelo: string;
  runtime: string;
  origemImagem: string;
  dimensoesOriginais: { largura: number; altura: number };
  dimensoesEntrada: { largura: number; altura: number };
  limiarScore: number;
  linhas: number[][];
}

const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/yolo-pose-yolov8n-frame-1.json", import.meta.url),
    "utf8"
  )
) as FixtureYoloPose;

const original = fixture.dimensoesOriginais;
const entrada = fixture.dimensoesEntrada;

function pontuar(linhas: number[][]) {
  return linhas.map((linha) => linha[4]);
}

describe("parser da saida real do YOLO Pose (P2.4)", () => {
  it("versiona a procedencia da amostra (modelo, runtime e imagem)", () => {
    expect(fixture.modelo).toBe("Xenova/yolov8n-pose");
    expect(fixture.sha256Modelo).toMatch(/^[0-9a-f]{64}$/);
    expect(fixture.runtime).toContain("onnxruntime");
    expect(fixture.origemImagem).toContain("frame-1.jpg");
    // O modelo foi executado com a imagem original em 640x480 redimensionada
    // para a entrada 640x640 (sem pad), por isso a escala vertical nao e 1.
    expect(original).toEqual({ largura: 640, altura: 480 });
    expect(entrada).toEqual({ largura: 640, altura: 640 });
    expect(fixture.limiarScore).toBe(LIMIAR_SCORE_POSE);
  });

  it("mantem apenas as 10 linhas com score >= 0.3 e descarta as 2 abaixo", () => {
    const scores = pontuar(fixture.linhas);
    expect(fixture.linhas).toHaveLength(12);
    expect(scores.filter((s) => s >= LIMIAR_SCORE_POSE)).toHaveLength(10);
    expect(scores.filter((s) => s < LIMIAR_SCORE_POSE)).toHaveLength(2);

    const { pessoas } = interpretarLinhasYoloPose(fixture.linhas, entrada, original);
    expect(pessoas).toHaveLength(10);
    // A ordem das linhas do tensor e preservada.
    expect(pessoas.map((p) => p.confianca)).toEqual(
      scores.filter((s) => s >= LIMIAR_SCORE_POSE)
    );
  });

  it("preserva score da pessoa e confianca de cada keypoint", () => {
    const { pessoas } = interpretarLinhasYoloPose(fixture.linhas, entrada, original);
    const primeira = pessoas[0];
    // Valores reais da linha de maior score da amostra (ver fixture).
    expect(primeira.confianca).toBeCloseTo(0.808503, 6);
    expect(primeira.keypoints).toHaveLength(KEYPOINTS_POR_PESSOA);
    expect(primeira.keypoints[0].x).toBeCloseTo(359.365662, 5);
    expect(primeira.keypoints[0].y).toBeCloseTo(217.851837, 5);
    expect(primeira.keypoints[0].confianca).toBeCloseTo(0.997167, 6);
    // Keypoints de baixa visibilidade continuam presentes (nao sao filtrados
    // por confianca individual): a decisao de uso e do consumidor.
    expect(primeira.keypoints[7].confianca).toBeCloseTo(0.036292, 6);
  });

  it("escala x/y da entrada para a resolucao original", () => {
    const { pessoas } = interpretarLinhasYoloPose(fixture.linhas, entrada, original);
    const linha = fixture.linhas[0];
    const keypoint = pessoas[0].keypoints[5];
    expect(keypoint.x).toBeCloseTo(linha[5 + 5 * 3], 6);
    // 640 -> 640 em x; 640 -> 480 em y.
    expect(keypoint.y).toBeCloseTo((linha[5 + 5 * 3 + 1] * 480) / 640, 6);
  });

  it("aceita outra resolucao de entrada sem depender de 640", () => {
    const { pessoas } = interpretarLinhasYoloPose(
      fixture.linhas,
      { largura: 320, altura: 320 },
      original
    );
    const linha = fixture.linhas[0];
    expect(pessoas[0].keypoints[0].x).toBeCloseTo(linha[5] * 2, 6);
    expect(pessoas[0].keypoints[0].y).toBeCloseTo(linha[6] * 1.5, 6);
  });

  it("respeita limiar de score customizado", () => {
    const { pessoas } = interpretarLinhasYoloPose(
      fixture.linhas,
      entrada,
      original,
      0.9
    );
    expect(pessoas).toHaveLength(3);
    for (const pessoa of pessoas) expect(pessoa.confianca).toBeGreaterThanOrEqual(0.9);
  });

  it("nao inventa keypoints em linha truncada e descarta linha sem score", () => {
    const truncada = [0, 0, 0, 0, 0.9, 10, 20, 0.5, 30, 40];
    const semScore = [0, 0, 0, 0];
    const vazia: number[] = [];
    const { pessoas } = interpretarLinhasYoloPose(
      [truncada, semScore, vazia],
      entrada,
      original
    );
    expect(pessoas).toHaveLength(1);
    // Somente a tripla completa (10, 20, 0.5) vira keypoint.
    expect(pessoas[0].keypoints).toEqual([
      { x: 10, y: 15, confianca: 0.5 },
    ]);
  });

  it("cai para escala 1 com dimensoes invalidas, sem gerar NaN/Infinity", () => {
    const { pessoas } = interpretarLinhasYoloPose(
      [[0, 0, 0, 0, 0.9, 10, 20, 0.5]],
      { largura: 0, altura: Number.NaN },
      original
    );
    expect(pessoas[0].keypoints[0]).toEqual({ x: 6400, y: 9600, confianca: 0.5 });
    expect(Number.isFinite(pessoas[0].keypoints[0].x)).toBe(true);
    expect(Number.isFinite(pessoas[0].keypoints[0].y)).toBe(true);
  });
});
