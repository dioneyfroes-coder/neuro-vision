/**
 * Stub de `@huggingface/transformers` usado nos testes unitarios do detector.
 * O `vitest.config.ts` mapeia a URL do CDN para este arquivo, que nao existe no
 * bundle do cliente (esbuild trata a URL como externa).
 */

export const env = { allowLocalModels: true, useBrowserCache: false };

export interface DeteccaoStub {
  label: string;
  score: number;
  box: { xmin: number; ymin: number; xmax: number; ymax: number };
}

export type DetectorStub = (
  _input: string,
  _opcoes?: { threshold?: number; percentage?: boolean }
) => Promise<DeteccaoStub[]>;

export interface ChamadaPipeline {
  task: string;
  model: string;
  device?: string;
}

export const chamadas: ChamadaPipeline[] = [];

export const controle: {
  deteccoes: DeteccaoStub[];
  falharPrimeira: boolean;
  /** Quantas chamadas de inferencia falham com erro de dispositivo. */
  falharExecucao: number;
  /** Mensagem do erro de execucao injetado. */
  erroExecucao: string;
  reset: () => void;
} = {
  deteccoes: [],
  falharPrimeira: false,
  falharExecucao: 0,
  erroExecucao: "WebGPU device lost during inference",
  reset() {
    chamadas.length = 0;
    controle.deteccoes = [];
    controle.falharPrimeira = false;
    controle.falharExecucao = 0;
    controle.erroExecucao = "WebGPU device lost during inference";
  },
};

export function pipeline(
  task: "object-detection",
  model: string,
  opcoes?: {
    device?: "webgpu" | "wasm";
    progress_callback?: (info: { status: string; file?: string; progress?: number }) => void;
  }
): Promise<DetectorStub> {
  chamadas.push({ task, model, device: opcoes?.device });
  if (controle.falharPrimeira && chamadas.length === 1) {
    return Promise.reject(new Error("sem webgpu"));
  }
  opcoes?.progress_callback?.({ status: "progress", file: "modelo.onnx", progress: 42 });
  const detector: DetectorStub = async () => {
    if (controle.falharExecucao > 0) {
      controle.falharExecucao -= 1;
      throw new Error(controle.erroExecucao);
    }
    return controle.deteccoes;
  };
  return Promise.resolve(detector);
}
