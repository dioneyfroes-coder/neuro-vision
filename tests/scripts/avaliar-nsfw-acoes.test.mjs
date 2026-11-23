import { describe, expect, it } from "vitest";
import { gerarRelatorioAcoesNsfw } from "../../scripts/avaliar-nsfw-acoes.mjs";

const anotacao = {
  versaoEsquema: 2,
  conjunto: "eval",
  revisao: { status: "revisada" },
  resolucaoMs: 200,
  acoes: [
    { inicioEm: "2026-11-22T12:00:00.000Z", fimEm: "2026-11-22T12:00:02.000Z" },
  ],
};

describe("harness de ações NSFW anotadas (Fase 4)", () => {
  it("recusa divulgar taxa sem anotação revisada", () => {
    const relatorio = gerarRelatorioAcoesNsfw(undefined, []);
    expect(relatorio.status).toBe("N/A");
    expect(relatorio.base).toBe("sem_anotacao_revisada");
    expect(relatorio.metricasDisponiveis).toBe(false);
    expect(relatorio.precisao).toBeNull();
    expect(relatorio.recall).toBeNull();
    expect(relatorio.motivo).toBeTruthy();
  });

  it("só mede com anotação revisada e respostas com intervalo", () => {
    const respostas = [
      {
        acoes: [
          { inicioEm: "2026-11-22T12:00:01.000Z", fimEm: "2026-11-22T12:00:02.000Z" },
        ],
      },
    ];
    const relatorio = gerarRelatorioAcoesNsfw(anotacao, respostas);
    expect(relatorio.status).toBe("medido");
    expect(relatorio.base).toBe("anotacao-revisada");
    expect(relatorio.metricasDisponiveis).toBe(true);
    expect(relatorio.precisao).toBe(1);
    expect(relatorio.recall).toBe(1);
  });

  it("aceita lista de respostas e não conta ações sem intervalo", () => {
    const respostas = [
      { acoes: [{ descricao: "sem tempo" }] },
      { acoes: [{ inicioEm: "2026-11-22T12:00:00.500Z", fimEm: "2026-11-22T12:00:01.000Z" }] },
    ];
    const relatorio = gerarRelatorioAcoesNsfw(anotacao, respostas);
    expect(relatorio.acoesInferidas).toBe(1);
    expect(relatorio.correspondencias).toBe(1);
  });
});
