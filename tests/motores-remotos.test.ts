import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MotorPose, SaidaPoseCru } from "../public/perception/adapters/pose-estimator.adapter";

const mocks = vi.hoisted(() => ({
  criarMotorPoseTransformers: vi.fn(),
}));

vi.mock("../public/pose", () => ({
  MODELO_POSE_PADRAO: "modelo-pose-teste",
  criarMotorPoseTransformers: mocks.criarMotorPoseTransformers,
}));

import { criarMotorPoseRemoto } from "../public/perception/workers/motores-remotos";

class WorkerFalso {
  onmessage: ((evento: MessageEvent) => void) | null = null;
  onerror: ((evento: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();

  constructor(
    private readonly falharCarga: boolean,
    private readonly falharInferencia: boolean
  ) {}

  postMessage(requisicao: { id: number; tipo: string }): void {
    queueMicrotask(() => {
      if (requisicao.tipo === "carregar" && this.falharCarga) {
        this.onerror?.({ message: "falha simulada de carga" } as ErrorEvent);
      } else if (requisicao.tipo === "executar" && this.falharInferencia) {
        this.onerror?.({ message: "falha simulada de inferencia" } as ErrorEvent);
      } else if (requisicao.tipo === "carregar") {
        this.onmessage?.({
          data: {
            id: requisicao.id,
            ok: true,
            valor: {
              modelo: "modelo-pose-teste",
              dispositivo: "wasm",
              versao: "3.8.1",
              tempoCargaMs: 1,
            },
          },
        } as MessageEvent);
      } else {
        this.onmessage?.({
          data: { id: requisicao.id, ok: true, valor: { pessoas: [], dimensoes: { largura: 2, altura: 2 } } },
        } as MessageEvent);
      }
    });
  }
}

const saidaLocal: SaidaPoseCru = {
  pessoas: [],
  dimensoes: { largura: 2, altura: 2 },
};

function motorLocal(encerrar = vi.fn()): MotorPose {
  return {
    dispositivo: "wasm",
    versao: "3.8.1",
    executar: vi.fn(async () => saidaLocal),
    encerrar,
  };
}

describe("fallback do motor remoto de pose", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("usa o motor local e o libera quando o worker falha ao carregar", async () => {
    const workers: WorkerFalso[] = [];
    vi.stubGlobal(
      "Worker",
      class extends WorkerFalso {
        constructor() {
          super(true, false);
          workers.push(this);
        }
      }
    );
    const encerrarLocal = vi.fn();
    const local = motorLocal(encerrarLocal);
    mocks.criarMotorPoseTransformers.mockResolvedValue(local);
    const aoStatus = vi.fn();

    const motor = await criarMotorPoseRemoto("modelo-pose-teste", aoStatus);

    expect(await motor.executar("frame")).toEqual(saidaLocal);
    expect(mocks.criarMotorPoseTransformers).toHaveBeenCalledWith("modelo-pose-teste", aoStatus);
    expect(aoStatus).toHaveBeenCalledWith(expect.stringContaining("usando a thread principal"));
    await motor.encerrar?.();
    expect(encerrarLocal).toHaveBeenCalledOnce();
    expect(workers[0].terminate).toHaveBeenCalled();
  });

  it("cai para o motor local se o worker falha durante a inferencia", async () => {
    const workers: WorkerFalso[] = [];
    vi.stubGlobal(
      "Worker",
      class extends WorkerFalso {
        constructor() {
          super(false, true);
          workers.push(this);
        }
      }
    );
    const encerrarLocal = vi.fn();
    mocks.criarMotorPoseTransformers.mockResolvedValue(motorLocal(encerrarLocal));
    const aoStatus = vi.fn();

    const motor = await criarMotorPoseRemoto("modelo-pose-teste", aoStatus);

    expect(await motor.executar("frame")).toEqual(saidaLocal);
    expect(aoStatus).toHaveBeenCalledWith(expect.stringContaining("usando a thread principal"));
    await motor.encerrar?.();
    expect(encerrarLocal).toHaveBeenCalledOnce();
    expect(workers[0].terminate).toHaveBeenCalled();
  });
});
