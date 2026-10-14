import { describe, expect, it } from "vitest";
import { entradaDeResultado } from "./percepcao";

const base = {
  modelo: "qwen3-vl:4b",
  duracaoMs: 123,
  objetos: [
    {
      nome: "pessoa",
      rotulo: "person",
      score: 0.9,
      caixa: { xmin: 0, ymin: 0, xmax: 1, ymax: 1 },
    },
  ],
  descricao: "Uma pessoa no escritorio.",
};

describe("entradaDeResultado", () => {
  it("converte um resultado de deteccao em entrada de historico", () => {
    const entrada = entradaDeResultado(base, "deteccao", "2026-10-11T00:00:00.000Z");
    expect(entrada).toMatchObject({
      timestamp: "2026-10-11T00:00:00.000Z",
      modelo: "qwen3-vl:4b",
      objetos: base.objetos,
      resumo: "Uma pessoa no escritorio.",
      tipo: "deteccao",
      ms: 123,
    });
    expect(entrada.papel).toBeUndefined();
    expect(entrada.snapshot).toBeUndefined();
  });

  it("define papel apenas para entradas de roteiro", () => {
    const entrada = entradaDeResultado(
      { ...base, confianca: { papel: "base" as const } },
      "roteiro",
      "t"
    );
    expect(entrada.papel).toBe("base");

    const descricao = entradaDeResultado(
      { ...base, confianca: { papel: "base" as const } },
      "descricao",
      "t"
    );
    expect(descricao.papel).toBeUndefined();
  });

  it("repassa snapshot, tokens e semMudanca", () => {
    const entrada = entradaDeResultado(
      {
        ...base,
        snapshot: "data:image/jpeg;base64,AAAA",
        capturadoEm: "2026-10-11T00:00:01.000Z",
        confianca: { tokens: 50, semMudanca: true },
      },
      "descricao",
      "t"
    );
    expect(entrada.snapshot).toBe("data:image/jpeg;base64,AAAA");
    expect(entrada.tokens).toBe(50);
    expect(entrada.capturadoEm).toBe("2026-10-11T00:00:01.000Z");
  });
});