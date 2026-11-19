import { describe, expect, it } from "vitest";
import {
  indisponivel,
  naoAmostrado,
} from "../../src/domain/perception";
import { estadoSubsistema } from "../../public/interpretation/esquema";

describe("estadoSubsistema", () => {
  it("deriva sem_resultado/ok/indisponivel do resultado e da telemetria", () => {
    expect(
      estadoSubsistema({ deteccoes: [] }, { status: "ok", modelo: "m" }, (r) => r.deteccoes.length === 0)
    ).toMatchObject({ status: "sem_resultado", modelo: "m" });
    expect(
      estadoSubsistema(
        { deteccoes: [{ nome: "p", rotulo: "p", score: 1, caixa: { xmin: 0, ymin: 0, xmax: 1, ymax: 1 } }] },
        undefined,
        (r) => r.deteccoes.length === 0
      ).status
    ).toBe("ok");
    expect(
      estadoSubsistema(indisponivel("pose", "falhou"), { modelo: "m" }, () => true)
    ).toMatchObject({ status: "indisponivel", motivo: "falhou" });
    expect(estadoSubsistema(undefined, { status: "nao_carregado" }, () => true).status).toBe(
      "nao_carregado"
    );
  });

  it("distingue frame pulado pela cadencia (nao_amostrado) de falha", () => {
    expect(
      estadoSubsistema(naoAmostrado("maos"), { modelo: "mediapipe" }, () => true)
    ).toMatchObject({
      status: "nao_amostrado",
      modelo: "mediapipe",
      motivo: "nao amostrado pela cadencia de percepcao",
    });
  });
});