declare module "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3" {
  export interface ProgressInfo {
    status: string;
    file?: string;
    progress?: number;
  }

  export interface Deteccao {
    label: string;
    score: number;
    box: { xmin: number; ymin: number; xmax: number; ymax: number };
  }

  export type Detector = (
    input: string,
    opcoes?: { threshold?: number; percentage?: boolean }
  ) => Promise<Deteccao[]>;

  export interface OpcoesPipeline {
    device?: "webgpu" | "wasm";
    progress_callback?: (info: ProgressInfo) => void;
  }

  export function pipeline(
    task: "object-detection",
    model: string,
    opcoes?: OpcoesPipeline
  ): Promise<Detector>;

  export const env: {
    allowLocalModels: boolean;
    useBrowserCache: boolean;
  };
}
