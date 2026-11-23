import { describe, expect, it } from "vitest";
import { gerarRelatorioGemma } from "../../scripts/verificar-gemma-fase5.mjs";

describe("harness de verificação Gemma (Fase 5)", () => {
  it("mantém INCONCLUSIVO sem snapshot real", () => {
    const relatorio = gerarRelatorioGemma(undefined);
    expect(relatorio.status).toBe("INCONCLUSIVO");
    expect(relatorio.base).toBe("sem_snapshot");
    expect(relatorio.disponibilidadeMedida).toBe(false);
    expect(relatorio.latenciaMs).toBeNull();
    expect(relatorio.ramMb).toBeNull();
    expect(relatorio.gemma.status).toBe("nao_verificado");
  });

  it("separa disponibilidade observada de desempenho não medido", () => {
    const relatorio = gerarRelatorioGemma({
      online: true,
      modelos: ["gemma-4-e2b-uncensored-hauhaucs-aggressive"],
      carregados: ["gemma-4-e2b-uncensored-hauhaucs-aggressive"],
    });
    expect(relatorio.status).toBe("observado");
    expect(relatorio.gemma.pronto).toBe(true);
    expect(relatorio.latenciaMs).toBeNull();
    expect(relatorio.comparacaoDescricoes.status).toBe("sem_dados");
  });
});
