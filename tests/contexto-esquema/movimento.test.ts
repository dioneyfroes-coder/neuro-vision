import { describe, expect, it } from "vitest";
import {
  calcularMovimento,
  NOMES_KEYPOINTS_COCO,
} from "../../public/interpretation/esquema";
import { observacao } from "../helpers/contexto-esquema";

describe("calcularMovimento", () => {
  it("nao gera movimento sem posicao anterior nem entidade rastreada", () => {
    const resultado = calcularMovimento(observacao(), new Map(), 2);
    expect(resultado.movimentos).toEqual([]);
    expect(resultado.posicoes.size).toBeGreaterThan(0);
  });

  it("ignora entidades sem trackId", () => {
    const semId = observacao({
      pose: { pessoas: [{ pontos: NOMES_KEYPOINTS_COCO.map(() => ({ x: 0.5, y: 0.5 })) }] },
      maos: { maos: [] },
    });
    const resultado = calcularMovimento(semId, new Map(), 2);
    expect(resultado.movimentos).toEqual([]);
  });
});