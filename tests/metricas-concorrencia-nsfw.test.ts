import { describe, expect, it } from "vitest";
import { resumirConcorrenciaNsfw } from "../src/domain/metricas-concorrencia-nsfw";
import type { AmostraConcorrenciaNsfw } from "../src/domain/metricas-concorrencia-nsfw";

describe("resumo de concorrencia NSFW (Fase 3)", () => {
  it("devolve sem_dados em vez de zero quando nao ha medicao", () => {
    const vazio = resumirConcorrenciaNsfw([]);
    expect(vazio.status).toBe("sem_dados");
    expect(vazio.motivo).toContain("nenhuma amostra");
    expect(vazio.concorrenciaMaxima).toBeNull();
    expect(vazio.latenciaMs).toEqual({ p50: null, p95: null, max: null });
  });

  it("conta sobreposicao de janelas com fronteira meio-aberta", () => {
    const amostras: AmostraConcorrenciaNsfw[] = [
      { modelo: "a", inicioMs: 0, fimMs: 10 },
      { modelo: "b", inicioMs: 2, fimMs: 8 },
      { modelo: "c", inicioMs: 8, fimMs: 20 },
      { modelo: "d", inicioMs: 10, fimMs: 12 },
    ];
    const resumo = resumirConcorrenciaNsfw(amostras);
    expect(resumo.status).toBe("medido");
    expect(resumo.concorrenciaMaxima).toBe(2);
    expect(resumo.amostras).toBe(4);
    expect(resumo.modelos).toEqual(["a", "b", "c", "d"]);
  });

  it("calcula latencia descritiva e ignora amostras invalidas", () => {
    const amostras: AmostraConcorrenciaNsfw[] = [
      { modelo: "a", inicioMs: 0, fimMs: 10 },
      { modelo: "b", inicioMs: 0, fimMs: 20 },
      { modelo: "c", inicioMs: 0, fimMs: 30, falha: true },
      { modelo: "e", inicioMs: 0, fimMs: 40 },
      { modelo: "", inicioMs: 0, fimMs: 5 },
      { modelo: "d", inicioMs: 10, fimMs: 5 },
    ];
    const resumo = resumirConcorrenciaNsfw(amostras);
    expect(resumo.status).toBe("medido");
    expect(resumo.amostras).toBe(4);
    expect(resumo.amostrasInvalidas).toBe(2);
    expect(resumo.falhas).toBe(1);
    expect(resumo.latenciaMs).toEqual({ p50: 20, p95: 40, max: 40 });
  });
});
