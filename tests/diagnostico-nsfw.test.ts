import { describe, expect, it } from "vitest";
import type { MetricasAdaptador } from "../public/perception/contracts";
import {
  modelosNsfwIndisponiveis,
  partesDiagnosticoNsfw,
} from "../public/ui/diagnostico-nsfw";

const metricasCom = (telemetriaModelos: MetricasAdaptador["telemetriaModelos"]): MetricasAdaptador => ({
  modelo: "conjunto-nsfw",
  status: "ok",
  telemetriaModelos,
});

describe("diagnostico NSFW (Fase 1)", () => {
  it("lista cada modelo indisponivel com o seu motivo", () => {
    const metricas = metricasCom([
      { modelo: "a", status: "ok" },
      { modelo: "b", status: "indisponivel", motivoFalha: "peso ausente" },
      { modelo: "c", status: "sem_resultado" },
    ]);
    expect(modelosNsfwIndisponiveis(metricas)).toEqual(["b: peso ausente"]);
    expect(partesDiagnosticoNsfw(metricas, true)).toEqual([
      "nsfw falhas 1/3: b: peso ausente",
    ]);
  });

  it("nao produz texto quando nao ha falha ou quando o NSFW nao rodou", () => {
    const metricas = metricasCom([{ modelo: "a", status: "ok" }]);
    expect(partesDiagnosticoNsfw(metricas, true)).toEqual([]);
    expect(partesDiagnosticoNsfw(metricas, false)).toEqual([]);
    expect(partesDiagnosticoNsfw(undefined, true)).toEqual([]);
  });

  it("nao transforma modelo sem resultado em falha individual", () => {
    const metricas = metricasCom([
      { modelo: "a", status: "sem_resultado" },
      { modelo: "b", status: "indisponivel" },
    ]);
    expect(modelosNsfwIndisponiveis(metricas)).toEqual(["b"]);
  });
});
