declare module "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1" {
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

  /** Tensor do Transformers.js (apenas o subconjunto usado pelo estimador de pose). */
  export interface Tensor {
    dims: number[];
    /** Indexacao por eixo (ex.: `tensor[0]`) devolve um sub-tensor. */
    [indice: number]: Tensor;
    transpose(...eixos: number[]): Tensor;
    tolist(): unknown;
  }

  /** Imagem crua carregada pelo Transformers.js. */
  export interface RawImage {
    width: number;
    height: number;
  }

  export interface ModeloTransformers {
    (entrada: { images: Tensor }): Promise<{ output0: Tensor }>;
  }

  export interface ProcessadorTransformers {
    (entrada: unknown): Promise<{ pixel_values: Tensor }>;
  }

  export interface OpcoesCarga {
    device?: "webgpu" | "wasm";
    progress_callback?: (info: ProgressInfo) => void;
  }

  export const AutoModel: {
    from_pretrained(modelo: string, opcoes?: OpcoesCarga): Promise<ModeloTransformers>;
  };

  export const AutoProcessor: {
    from_pretrained(modelo: string, opcoes?: OpcoesCarga): Promise<ProcessadorTransformers>;
  };

  export const RawImage: {
    read(entrada: string): Promise<RawImage>;
  };

  export const env: {
    allowLocalModels: boolean;
    useBrowserCache: boolean;
  };
}
