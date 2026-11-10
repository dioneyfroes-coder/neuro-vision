import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MotorPose, SaidaPoseCru } from "../public/perception/adapters/pose-estimator.adapter";

const mocks = vi.hoisted(() => ({
  criarMotorPoseTransformers: vi.fn(),
}));

vi.mock("../public/pose", () => ({
  MODELO_POSE_PADRAO: "modelo-pose-teste",
  criarMotorPoseTransformers: mocks.criarMotorPoseTransformers,
}));

import { criarMotorNsfwRemoto, criarMotorPoseRemoto } from "../public/perception/workers/motores-remotos";

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

/** Worker NSFW falso: registra as mensagens e responde carga/inferencia. */
class WorkerNsfwFalso {
  onmessage: ((evento: MessageEvent) => void) | null = null;
  onerror: ((evento: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  readonly mensagens: Array<Record<string, unknown>> = [];

  postMessage(requisicao: { id: number; tipo: string; modelo?: string }): void {
    this.mensagens.push(requisicao);
    queueMicrotask(() => {
      if (requisicao.tipo === "carregar") {
        this.onmessage?.({
          data: {
            id: requisicao.id,
            ok: true,
            valor: { modelo: requisicao.modelo, dispositivo: "wasm", tempoCargaMs: 1 },
          },
        } as MessageEvent);
      } else {
        this.onmessage?.({ data: { id: requisicao.id, ok: true, valor: [] } } as MessageEvent);
      }
    });
  }
}

describe("isolamento do motor NSFW por modelo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function instalarWorkers(): WorkerNsfwFalso[] {
    const workers: WorkerNsfwFalso[] = [];
    vi.stubGlobal(
      "Worker",
      class extends WorkerNsfwFalso {
        constructor() {
          super();
          workers.push(this);
        }
      }
    );
    return workers;
  }

  it("cria um Worker por motor e envia o modelo pedido a cada um", async () => {
    const workers = instalarWorkers();

    const motorA = criarMotorNsfwRemoto();
    await motorA.carregar("nudenet_320n");
    const motorB = criarMotorNsfwRemoto();
    await motorB.carregar("nudenet_640m");

    expect(workers).toHaveLength(2);
    expect(workers[0]).not.toBe(workers[1]);
    expect(workers[0].mensagens[0]).toMatchObject({
      tipo: "carregar",
      motor: "nsfw",
      modelo: "nudenet_320n",
    });
    expect(workers[1].mensagens[0]).toMatchObject({
      tipo: "carregar",
      motor: "nsfw",
      modelo: "nudenet_640m",
    });

    motorA.encerrar?.();
    motorB.encerrar?.();
    expect(workers[0].terminate).toHaveBeenCalled();
    expect(workers[1].terminate).toHaveBeenCalled();
  });

  it("troca de modelo encerra a thread anterior e abre outra", async () => {
    const workers = instalarWorkers();
    const motor = criarMotorNsfwRemoto();

    await motor.carregar("nudenet_320n");
    const primeiro = workers[0];
    await motor.carregar("erax_nsfw_yolo11n");

    expect(primeiro.terminate).toHaveBeenCalled();
    expect(workers).toHaveLength(2);
    expect(workers[1].mensagens[0]).toMatchObject({ modelo: "erax_nsfw_yolo11n" });
    // A nova thread nao herda a sessao ONNX da anterior.
    expect(workers[1]).not.toBe(primeiro);
  });

  it("recarregar o mesmo modelo reaproveita o Worker atual", async () => {
    const workers = instalarWorkers();
    const motor = criarMotorNsfwRemoto();

    await motor.carregar("nudenet_320n");
    await motor.carregar("nudenet_320n");

    expect(workers).toHaveLength(1);
    expect(workers[0].terminate).not.toHaveBeenCalled();
    expect(await motor.executar("frame")).toEqual([]);
  });

  it("sem modelo explicito usa o NudeNet 320n como padrao", async () => {
    const workers = instalarWorkers();
    const motor = criarMotorNsfwRemoto();

    await motor.carregar(null);

    expect(workers[0].mensagens[0]).toMatchObject({ modelo: "nudenet_320n" });
  });
});
