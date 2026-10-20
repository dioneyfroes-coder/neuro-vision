import { describe, expect, it } from "vitest";
import { descreverDeteccoes, traduzir } from "../public/detector";

/**
 * Helpers de rotulo/resumo da deteccao. O motor em si agora e o YOLO em ONNX
 * (`public/yolo-onnx.ts`, coberto por `tests/yolo-onnx.test.ts` e pela
 * verificacao empirica em `scripts/verificar-yolo-onnx.mjs`); aqui ficam a
 * traducao COCO -> portugues e a montagem do log.
 */
describe("traduzir", () => {
  it("traduz rotulos COCO conhecidos", () => {
    expect(traduzir("person")).toBe("pessoa");
    expect(traduzir("cell phone")).toBe("celular");
  });

  it("mantem rotulos desconhecidos", () => {
    expect(traduzir("coisa estranha")).toBe("coisa estranha");
  });
});

describe("descreverDeteccoes", () => {
  it("converte deteccoes em objetos e resumo com contagem", () => {
    const { objetos, resumo } = descreverDeteccoes([
      { label: "person", score: 0.9876, box: { xmin: 1, ymin: 2, xmax: 3, ymax: 4 } },
      { label: "person", score: 0.5, box: { xmin: 5, ymin: 6, xmax: 7, ymax: 8 } },
      { label: "dog", score: 0.4, box: { xmin: 9, ymin: 10, xmax: 11, ymax: 12 } },
    ]);

    expect(objetos[0]).toEqual({
      nome: "pessoa",
      rotulo: "person",
      score: 0.988,
      caixa: { xmin: 1, ymin: 2, xmax: 3, ymax: 4 },
    });
    expect(resumo).toBe("2x pessoa, cachorro");
  });

  it("usa 'nada reconhecido' quando nao ha deteccoes", () => {
    expect(descreverDeteccoes([]).resumo).toBe("nada reconhecido");
    expect(descreverDeteccoes([]).objetos).toEqual([]);
  });
});
