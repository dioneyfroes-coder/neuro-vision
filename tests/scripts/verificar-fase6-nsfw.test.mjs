import { describe, expect, it } from "vitest";

import { gerarRelatorioFase6 } from "../../scripts/verificar-fase6-nsfw.mjs";

describe("harness de validação e manutenção (Fase 6)", () => {
  it("mantém INCONCLUSIVO e N/A sem manifestos nem anotação", () => {
    const relatorio = gerarRelatorioFase6();
    expect(relatorio.status).toBe("INCONCLUSIVO");
    expect(relatorio.base).toBe("sem_dados_reais");
    expect(relatorio.dataset.status).toBe("sem_dados");
    expect(relatorio.metricas.status).toBe("sem_dados");
    expect(relatorio.descricoes.status).toBe("sem_dados");
    expect(relatorio.proveniencia.status).toBe("sem_dados");
    expect(relatorio.medicoes).toEqual({
      precisao: null,
      recall: null,
      f1: null,
      latenciaMs: null,
      ramMb: null,
    });
  });

  it("separa dados declarativos de medição: contagens não viram desempenho", () => {
    // Entradas sintéticas exercitam apenas o contrato dos validadores — não
    // são dataset revisado nem medição de modelo.
    const relatorio = gerarRelatorioFase6({
      dataset: {
        manifesto: { versaoEsquema: 1 },
        entradas: [
          { split: "treino", clip: "a.mp4", sha256: "a".repeat(64) },
          {
            split: "teste",
            clip: "c.mp4",
            sha256: "c".repeat(64),
            anotacao: {
              versaoEsquema: 2,
              conjunto: "teste",
              revisao: { status: "revisada" },
            },
          },
        ],
      },
      metricas: {
        anotacao: {
          versaoEsquema: 2,
          conjunto: "teste",
          revisao: { status: "revisada" },
          referencias: [{ clip: "c.mp4", modelo: "m", classe: "A" }],
        },
        inferidas: [{ clip: "c.mp4", modelo: "m", classe: "A" }],
      },
      descricoes: {
        pares: [{ id: "x", sfw: "a", especializada: "b" }],
        revisoes: [],
      },
      proveniencia: { manifesto: {}, pesos: [] },
      arquivosVersionados: ["src/a.ts"],
    });
    expect(relatorio.dataset.status).toBe("valido");
    expect(relatorio.metricas.status).toBe("medido");
    expect(relatorio.medicoes.precisao).toBe(1);
    expect(relatorio.medicoes.latenciaMs).toBeNull();
    expect(relatorio.medicoes.ramMb).toBeNull();
    expect(relatorio.descricoes.status).toBe("sem_dados");
    expect(relatorio.status).toBe("INCONCLUSIVO");
    expect(relatorio.avisos).toContain("contagem de rotulos nao e precisao do sistema em campo");
  });
});
