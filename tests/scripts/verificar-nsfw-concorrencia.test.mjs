import { describe, expect, it } from "vitest";
import { gerarRelatorioConcorrencia } from "../../scripts/verificar-nsfw-concorrencia.mjs";

describe("harness de concorrencia NSFW (Fase 3)", () => {
  it("recusa inventar numeros sem amostras instrumentadas", () => {
    const relatorio = gerarRelatorioConcorrencia([], undefined);
    expect(relatorio.status).toBe("sem_dados");
    expect(relatorio.base).toBe("sem_amostras");
    expect(relatorio.concorrenciaMaxima).toBeNull();
    expect(relatorio.latenciaMs).toEqual({ p50: null, p95: null, max: null });
    expect(relatorio.memoria.status).toBe("N/A");
    expect(relatorio.ambiente).toBe("nao informado");
  });

  it("marca base=amostras-fornecidas apenas com janelas validas", () => {
    const relatorio = gerarRelatorioConcorrencia(
      [
        { modelo: "a", inicioMs: 0, fimMs: 10 },
        { modelo: "b", inicioMs: 2, fimMs: 8 },
        { modelo: "c", inicioMs: 0, fimMs: 14 },
      ],
      "PC de referencia"
    );
    expect(relatorio.status).toBe("medido");
    expect(relatorio.base).toBe("amostras-fornecidas");
    expect(relatorio.ambiente).toBe("PC de referencia");
    expect(relatorio.concorrenciaMaxima).toBe(3);
    expect(relatorio.latenciaMs).toEqual({ p50: 10, p95: 14, max: 14 });
    expect(relatorio.memoria.status).toBe("N/A");
  });

  it("nao confunde lixo com medicao", () => {
    const relatorio = gerarRelatorioConcorrencia(
      [{ modelo: "a", inicioMs: 10, fimMs: 0 }, null],
      undefined
    );
    expect(relatorio.status).toBe("sem_dados");
    expect(relatorio.amostrasInvalidas).toBe(2);
    expect(relatorio.concorrenciaMaxima).toBeNull();
  });
});
