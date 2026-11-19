import { describe, expect, it, vi } from "vitest";
import { AdaptadorPose } from "../../public/perception/adapters/pose-estimator.adapter";
import type { MotorPose, SaidaPoseCru } from "../../public/perception/adapters/pose-estimator.adapter";
import type { MetricasAdaptador } from "../../public/perception/contracts";
import { fakeMotorPose } from "../helpers/percepcao-contratos";

describe("AdaptadorPose — idempotencia e encerramento", () => {
  it("nao recria o motor quando o mesmo modelo e carregado de novo", async () => {
    const motor = fakeMotorPose();
    const criar = vi.fn(async () => motor);
    const adaptador = new AdaptadorPose(criar);

    await adaptador.carregar("modelo-a");
    await adaptador.carregar("modelo-a");
    expect(criar).toHaveBeenCalledTimes(1);
    expect(motor.encerrar).not.toHaveBeenCalled();
  });

  it("troca de modelo encerra o motor anterior antes de criar o novo", async () => {
    const primeiro = fakeMotorPose();
    const segundo = fakeMotorPose();
    const criar = vi
      .fn<[string, ((m: string) => void)?], Promise<MotorPose>>()
      .mockResolvedValueOnce(primeiro)
      .mockResolvedValueOnce(segundo);
    const adaptador = new AdaptadorPose(criar);

    await adaptador.carregar("modelo-a");
    await adaptador.carregar("modelo-b");
    expect(primeiro.encerrar).toHaveBeenCalledTimes(1);
    expect(segundo.encerrar).not.toHaveBeenCalled();
    expect(adaptador.modelo).toBe("modelo-b");
  });

  it("encerrar libera o motor e permite recarregar do zero", async () => {
    const motor = fakeMotorPose();
    const criar = vi.fn(async () => fakeMotorPose());
    criar.mockResolvedValueOnce(motor);
    const adaptador = new AdaptadorPose(criar);

    await adaptador.carregar("modelo-a");
    await adaptador.encerrar();
    expect(motor.encerrar).toHaveBeenCalledTimes(1);
    expect(adaptador.metricas.status).toBe("nao_carregado");

    await adaptador.carregar("modelo-a");
    expect(criar).toHaveBeenCalledTimes(2);
  });

  it("aguarda a liberacao assincrona do motor", async () => {
    let liberar!: () => void;
    const pendente = new Promise<void>((resolve) => {
      liberar = resolve;
    });
    const encerrarMotor = vi.fn(async () => pendente);
    const adaptador = new AdaptadorPose(async () => ({
      ...fakeMotorPose(),
      encerrar: encerrarMotor,
    }));
    await adaptador.carregar("modelo-pose");

    let liberacaoConcluida = false;
    const encerramento = adaptador.encerrar().then(() => {
      liberacaoConcluida = true;
    });
    await Promise.resolve();
    expect(encerrarMotor).toHaveBeenCalledOnce();
    expect(liberacaoConcluida).toBe(false);

    liberar();
    await encerramento;
    expect(liberacaoConcluida).toBe(true);
    expect(adaptador.modelo).toBeNull();
  });

  it("estimar sem motor carregado devolve indisponivel (nunca lista vazia)", async () => {
    const adaptador = new AdaptadorPose(async () => fakeMotorPose());
    const resultado = await adaptador.estimar({ imagem: "data:x" });
    expect("indisponivel" in resultado).toBe(true);
  });
});

describe("AdaptadorPose — telemetria por modelo", () => {
  function resultado(parcial: Partial<SaidaPoseCru> = {}): SaidaPoseCru {
    return {
      pessoas: [{ keypoints: [{ x: 50, y: 50, confianca: 0.9 }], confianca: 0.9 }],
      dimensoes: { largura: 100, altura: 100 },
      ...parcial,
    };
  }

  it("registra modelo, dispositivo, versao, status e tempos", async () => {
    const adaptador = new AdaptadorPose(async () => ({
      executar: async () => resultado(),
      dispositivo: "wasm",
      versao: "teste-1.0",
    }));

    await adaptador.carregar("Xenova/yolov8n-pose");
    const metricas = adaptador.metricas as MetricasAdaptador;
    expect(metricas.modelo).toBe("Xenova/yolov8n-pose");
    expect(metricas.dispositivo).toBe("wasm");
    expect(metricas.versao).toBe("teste-1.0");
    expect(metricas.status).toBe("ok");
    expect(metricas.tempoCargaMs).toBeTypeOf("number");

    await adaptador.estimar({ imagem: "data:x" });
    expect(metricas.tempoInferenciaMs).toBeTypeOf("number");
    expect(metricas.status).toBe("ok");
  });

  it("marca 'sem_resultado' quando o modelo roda e nao encontra pessoa", async () => {
    const adaptador = new AdaptadorPose(async () => ({
      executar: async () => resultado({ pessoas: [] }),
    }));
    await adaptador.carregar("modelo");
    await adaptador.estimar({ imagem: "data:x" });
    expect(adaptador.metricas.status).toBe("sem_resultado");
  });

  it("marca 'indisponivel' com motivoFalha quando a inferencia lanca", async () => {
    const adaptador = new AdaptadorPose(async () => ({
      executar: async () => {
        throw new Error("falha simulada");
      },
    }));
    await adaptador.carregar("modelo");
    const saida = await adaptador.estimar({ imagem: "data:x" });
    expect("indisponivel" in saida).toBe(true);
    expect(adaptador.metricas.status).toBe("indisponivel");
    expect(adaptador.metricas.motivoFalha).toBe("falha simulada");
  });
});
