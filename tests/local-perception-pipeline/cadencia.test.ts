import { describe, expect, it } from "vitest";
import { PipelineLocal } from "../../public/perception/local-perception-pipeline";
import { naoFoiAmostrado } from "../../src/domain";
import {
  DetectorFalso,
  MAOS,
  MaosFalso,
  PoseFalso,
  snapshot,
} from "../helpers/local-perception-pipeline";

describe("PipelineLocal com cadencia independente", () => {
  it("executa apenas os subsistemas amostrados e marca o restante como nao amostrado", async () => {
    const ordem: string[] = [];
    const pipeline = new PipelineLocal({
      detector: new DetectorFalso(ordem),
      pose: new PoseFalso(ordem),
      maos: new MaosFalso(ordem),
    });

    const resultado = await pipeline.processarFrame(
      snapshot(),
      undefined,
      new Set(["maos"])
    );

    // So as maos tocam o SDK neste frame.
    expect(ordem).toEqual(["maos"]);
    expect(resultado.maos).toEqual(MAOS);
    expect(naoFoiAmostrado(resultado.deteccoes)).toBe(true);
    expect(naoFoiAmostrado(resultado.pose)).toBe(true);
    expect(resultado.deteccoes).toMatchObject({ subsistema: "deteccao", naoAmostrado: true });
    // Tempo de inferencia zero: o frame pulado nao conta como custo.
    expect(resultado.metricas.duracaoDeteccaoMs).toBe(0);
    expect(resultado.metricas.duracaoPoseMs).toBe(0);
  });

  it("registra status `nao_amostrado` na telemetria sem herdar tempo de inferencia", async () => {
    const pipeline = new PipelineLocal({
      detector: new DetectorFalso(),
      pose: new PoseFalso(),
      maos: new MaosFalso(),
    });

    const resultado = await pipeline.processarFrame(
      snapshot(),
      undefined,
      new Set(["deteccao"])
    );

    expect(resultado.metricas.subsistemas?.deteccao).toMatchObject({ status: "ok" });
    expect(resultado.metricas.subsistemas?.pose).toMatchObject({ status: "nao_amostrado" });
    expect(resultado.metricas.subsistemas?.maos).toMatchObject({ status: "nao_amostrado" });
    expect(resultado.metricas.subsistemas?.pose?.tempoInferenciaMs).toBeUndefined();
  });

  it("sem conjunto de amostragem, preserva o comportamento anterior (todos rodam)", async () => {
    const ordem: string[] = [];
    const pipeline = new PipelineLocal({
      detector: new DetectorFalso(ordem),
      pose: new PoseFalso(ordem),
      maos: new MaosFalso(ordem),
    });
    await pipeline.processarFrame(snapshot());
    expect(ordem).toEqual(["deteccao", "pose", "maos"]);
  });
});
