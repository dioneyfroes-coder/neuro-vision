import { describe, expect, it } from "vitest";
import { avaliarAcoesNsfwAnotadas } from "../src/domain/avaliacao-nsfw-anotada";
import type { AnotacaoNsfw } from "../src/domain/avaliacao-nsfw-anotada";

const anotacaoValida: AnotacaoNsfw = {
  versaoEsquema: 2,
  conjunto: "eval",
  revisao: { status: "revisada" },
  resolucaoMs: 200,
  acoes: [
    { inicioEm: "2026-11-22T12:00:00.000Z", fimEm: "2026-11-22T12:00:02.000Z" },
    { inicioEm: "2026-11-22T12:00:03.000Z", fimEm: "2026-11-22T12:00:05.000Z" },
  ],
};

describe("avaliação NSFW com anotação revisada (Fase 4)", () => {
  it("devolve N/A com motivo — nunca zero — quando falta anotação", () => {
    for (const anotacao of [undefined, null, {}, { ...anotacaoValida, conjunto: "dev" },
      { ...anotacaoValida, revisao: { status: "rascunho" } },
      { ...anotacaoValida, versaoEsquema: 1 },
      { ...anotacaoValida, resolucaoMs: 1000 }]) {
      const resultado = avaliarAcoesNsfwAnotadas(anotacao, [
        { inicioEm: "2026-11-22T12:00:00.000Z", fimEm: "2026-11-22T12:00:01.000Z" },
      ]);
      expect(resultado.status).toBe("N/A");
      expect(resultado.motivo).toBeTruthy();
      expect(resultado.precisao).toBeNull();
      expect(resultado.recall).toBeNull();
    }
  });

  it("conta correspondências por sobreposição de intervalos", () => {
    const resultado = avaliarAcoesNsfwAnotadas(anotacaoValida, [
      { inicioEm: "2026-11-22T12:00:01.000Z", fimEm: "2026-11-22T12:00:02.500Z" },
      { inicioEm: "2026-11-22T12:00:03.500Z", fimEm: "2026-11-22T12:00:04.000Z" },
      { inicioEm: "2026-11-22T12:00:10.000Z", fimEm: "2026-11-22T12:00:11.000Z" },
    ]);

    expect(resultado.status).toBe("medido");
    expect(resultado.acoesAnotadas).toBe(2);
    expect(resultado.acoesInferidas).toBe(3);
    expect(resultado.correspondencias).toBe(2);
    expect(resultado.falsosPositivos).toBe(1);
    expect(resultado.omissoes).toBe(0);
    expect(resultado.precisao).toBeCloseTo(2 / 3, 5);
    expect(resultado.recall).toBe(1);
  });

  it("não casa duas inferidas com a mesma anotação e ignora intervalos inválidos", () => {
    const resultado = avaliarAcoesNsfwAnotadas(anotacaoValida, [
      { inicioEm: "2026-11-22T12:00:00.500Z", fimEm: "2026-11-22T12:00:01.000Z" },
      { inicioEm: "2026-11-22T12:00:01.200Z", fimEm: "2026-11-22T12:00:01.500Z" },
      { inicioEm: "2026-11-22T12:00:04.000Z", fimEm: "2026-11-22T12:00:01.000Z" },
    ]);
    expect(resultado.correspondencias).toBe(1);
    expect(resultado.acoesInferidas).toBe(2);
    expect(resultado.omissoes).toBe(1);
  });

  it("N/A quando anotação ou resposta não têm intervalos válidos", () => {
    expect(avaliarAcoesNsfwAnotadas({ ...anotacaoValida, acoes: [] }, []).status).toBe("N/A");
    expect(avaliarAcoesNsfwAnotadas(anotacaoValida, []).status).toBe("N/A");
  });
});
