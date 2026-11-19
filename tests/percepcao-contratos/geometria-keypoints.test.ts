import { describe, expect, it } from "vitest";
import { normalizarPoses } from "../../public/perception/adapters/pose-estimator.adapter";
import type { SaidaPoseCru } from "../../public/perception/adapters/pose-estimator.adapter";

describe("geometria de keypoints (validacao deterministica, item 4)", () => {  const FIXTURES: { nome: string; entrada: SaidaPoseCru; esperado: ReturnType<typeof normalizarPoses> }[] =
    [
      {
        nome: "keypoints nas bordas da imagem permanecem em [0,1]",
        entrada: {
          pessoas: [
            {
              keypoints: [
                { x: 0, y: 0, confianca: 1 },
                { x: 640, y: 480, confianca: 1 },
              ],
            },
          ],
          dimensoes: { largura: 640, altura: 480 },
        },
        esperado: {
          pessoas: [
            {
              pontos: [
                { x: 0, y: 0, confianca: 1 },
                { x: 1, y: 1, confianca: 1 },
              ],
            },
          ],
        },
      },
    ];

  for (const fixture of FIXTURES) {
    it(fixture.nome, () => {
      expect(normalizarPoses(fixture.entrada)).toEqual(fixture.esperado);
    });
  }

  it("prende keypoints fora do frame em [0,1] e nao gera NaN", () => {
    const resultado = normalizarPoses({
      pessoas: [
        {
          keypoints: [
            { x: -50, y: 900, confianca: 0.5 },
            { x: Number.NaN, y: 100, confianca: 0.5 },
          ],
        },
      ],
      dimensoes: { largura: 640, altura: 480 },
    });
    const [a, b] = resultado.pessoas[0].pontos;
    expect(a).toEqual({ x: 0, y: 1, confianca: 0.5 });
    expect(b).toEqual({ x: 0, y: expect.any(Number), confianca: 0.5 });
    expect(Number.isFinite(b.x) && Number.isFinite(b.y)).toBe(true);
  });

  it("dimensoes degeneradas (0) nao geram divisao por zero", () => {
    const resultado = normalizarPoses({
      pessoas: [{ keypoints: [{ x: 10, y: 10, confianca: 0.5 }] }],
      dimensoes: { largura: 0, altura: 0 },
    });
    expect(resultado.pessoas[0].pontos[0].x).toBe(1);
    expect(resultado.pessoas[0].pontos[0].y).toBe(1);
  });
});
