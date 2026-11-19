import { describe, expect, it } from "vitest";
import { AdaptadorClassificadorNsfw } from "../../public/perception/adapters/nsfw-classifier.adapter";
import { ENTRADA, MotorFalso } from "../helpers/nsfw-classifier-adapter";

describe("AdaptadorClassificadorNsfw - telemetria de fallback", () => {
  it("registra o motivo do fallback sem marcar o modelo como indisponivel", async () => {
    const motor = new MotorFalso("worker de nsfw indisponivel; usando a thread principal");
    const adaptador = new AdaptadorClassificadorNsfw(motor);
    await adaptador.carregar("nudenet_320n");
    expect(adaptador.metricas.status).toBe("ok");
    expect(adaptador.metricas.motivoFallback).toContain("thread principal");
    await adaptador.avaliar(ENTRADA);
    expect(adaptador.metricas.motivoFallback).toContain("thread principal");
  });

  it("nao inventa motivo quando a inferencia rodou no worker", async () => {
    const adaptador = new AdaptadorClassificadorNsfw(new MotorFalso(null));
    await adaptador.carregar("nudenet_320n");
    expect(adaptador.metricas.motivoFallback).toBeUndefined();
  });

  it("limpa o motivo ao encerrar", async () => {
    const adaptador = new AdaptadorClassificadorNsfw(new MotorFalso("worker caiu"));
    await adaptador.carregar("nudenet_320n");
    adaptador.encerrar();
    expect(adaptador.metricas.motivoFallback).toBeUndefined();
  });
});
