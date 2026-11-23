import { describe, expect, it } from "vitest";
import {
  configurarSubsistemas,
  criarProcessadorInativo,
} from "../../public/perception/local-perception-pipeline";
import type { EstimadorPose } from "../../public/perception/contracts";
import { estaIndisponivel } from "../../src/domain";
import { DetectorFalso, MaosFalso, PoseFalso, snapshot } from "../helpers/local-perception-pipeline";

describe("configurarSubsistemas", () => {
  it("isola falha de carregamento: carregados continuam e falhas sao registradas", async () => {
    const status: string[] = [];
    const detector = new DetectorFalso();
    const pose: PoseFalso = Object.assign(new PoseFalso(), {
      carregar: async () => {
        throw new Error("erro ao carregar pose");
      },
    });
    const maos = new MaosFalso();
    const resultado = await configurarSubsistemas(
      { detector, pose: pose as unknown as EstimadorPose, maos },
      { objetos: "obj", pose: "pose", maos: "maos" },
      (m) => status.push(m)
    );
    expect(resultado.carregados).toEqual(["deteccao", "maos"]);
    expect(resultado.falhas).toEqual([{ subsistema: "pose", motivo: "erro ao carregar pose" }]);
    expect(status).toEqual(expect.arrayContaining(["pose indisponivel: erro ao carregar pose"]));
  });

  it("preserva e anuncia a falha individual de uma carga parcial", async () => {
    const status: string[] = [];
    const detector = new DetectorFalso();
    detector.metricas.motivoFalha = "b: peso ausente";
    const pose = new PoseFalso();
    const maos = new MaosFalso();
    const resultado = await configurarSubsistemas(
      { detector, pose, maos },
      { objetos: "obj", pose: "pose", maos: "maos" },
      (m) => status.push(m)
    );

    expect(resultado.carregados).toContain("deteccao");
    expect(resultado.falhas).toEqual([]);
    expect(resultado.carregamento?.deteccao).toMatchObject({
      status: "ok",
      motivoFalha: "b: peso ausente",
    });
    expect(status).toEqual(
      expect.arrayContaining(["deteccao carregou parcialmente: b: peso ausente"])
    );
  });
});

describe("criarProcessadorInativo (variante B, sem percepcao local)", () => {
  it("devolve os tres subsistemas indisponiveis sem carregar modelo", async () => {
    const processar = criarProcessadorInativo();
    const resultado = await processar(snapshot());

    expect(estaIndisponivel(resultado.deteccoes)).toBe(true);
    expect(estaIndisponivel(resultado.pose)).toBe(true);
    expect(estaIndisponivel(resultado.maos)).toBe(true);
    // Telemetria explicita: cada subsistema desativado aparece como
    // `indisponivel` com motivo, distinguivel de "rodou e nao encontrou nada".
    expect(resultado.metricas.subsistemas).toMatchObject({
      deteccao: { status: "indisponivel" },
      pose: { status: "indisponivel" },
      maos: { status: "indisponivel" },
    });
  });
});
