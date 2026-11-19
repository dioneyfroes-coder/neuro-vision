import { describe, expect, it, vi } from "vitest";
import { AdaptadorMaos } from "../../public/perception/adapters/hand-gesture.adapter";
import type { MotorMaos } from "../../public/perception/adapters/hand-gesture.adapter";
import { fakeMotorMaos } from "../helpers/percepcao-contratos";

describe("AdaptadorMaos — idempotencia, encerramento e telemetria", () => {
  it("nao recria o motor com o mesmo modelo e encerra ao trocar", async () => {
    const primeiro = fakeMotorMaos();
    const segundo = fakeMotorMaos();
    const criar = vi
      .fn<[string, ((m: string) => void)?], Promise<MotorMaos>>()
      .mockResolvedValueOnce(primeiro)
      .mockResolvedValueOnce(segundo);
    const adaptador = new AdaptadorMaos(criar);

    await adaptador.carregar("m");
    await adaptador.carregar("m");
    expect(criar).toHaveBeenCalledTimes(1);

    await adaptador.carregar("n");
    expect(primeiro.encerrar).toHaveBeenCalledTimes(1);
    expect(adaptador.metricas.dispositivo).toBe("cpu");
    expect(adaptador.metricas.versao).toBe("mediapipe-0.10.21");
  });
});
