/**
 * URLs locais (`/modelos/coco/...`) dos pesos. Quando `modelos/` esta servido
 * pelo servidor, o detector usa estes caminhos em vez do Hugging Face.
 */
export const MODELOS_COCO_LOCAIS: Record<string, string> = {
  "onnx-community/yolov10n": "coco/yolov10n.onnx",
  "onnx-community/yolov10s": "coco/yolov10s.onnx",
};

/** Lado do quadrado de entrada exigido pelo YOLOv10. */
export const LADO_ENTRADA_YOLO = 640;

/** Caixa em pixels da imagem analisada. */
export interface CaixaYOLO {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}

/** Deteccao crua (rotulo COCO em ingles, como o modelo devolve). */
export interface DeteccaoYOLO {
  label: string;
  score: number;
  box: CaixaYOLO;
}

/** Opcoes da inferencia (espelha `OpcoesDeteccao` do contrato). */
export interface OpcoesInferenciaYolo {
  threshold?: number;
  percentage?: boolean;
}

/** Rotulos COCO em ingles, na ordem das classes do modelo (id -> rotulo). */
export const COCO_INGLES = [
  "person",
  "bicycle",
  "car",
  "motorcycle",
  "airplane",
  "bus",
  "train",
  "truck",
  "boat",
  "traffic light",
  "fire hydrant",
  "stop sign",
  "parking meter",
  "bench",
  "bird",
  "cat",
  "dog",
  "horse",
  "sheep",
  "cow",
  "elephant",
  "bear",
  "zebra",
  "giraffe",
  "backpack",
  "umbrella",
  "handbag",
  "tie",
  "suitcase",
  "frisbee",
  "skis",
  "snowboard",
  "sports ball",
  "kite",
  "baseball bat",
  "baseball glove",
  "skateboard",
  "surfboard",
  "tennis racket",
  "bottle",
  "wine glass",
  "cup",
  "fork",
  "knife",
  "spoon",
  "bowl",
  "banana",
  "apple",
  "sandwich",
  "orange",
  "broccoli",
  "carrot",
  "hot dog",
  "pizza",
  "donut",
  "cake",
  "chair",
  "couch",
  "potted plant",
  "bed",
  "dining table",
  "toilet",
  "tv",
  "laptop",
  "mouse",
  "remote",
  "keyboard",
  "cell phone",
  "microwave",
  "oven",
  "toaster",
  "sink",
  "refrigerator",
  "book",
  "clock",
  "vase",
  "scissors",
  "teddy bear",
  "hair drier",
  "toothbrush",
];

/** Catalogo de modelos COCO expostos na interface (`#model`). */
export interface ModeloCocoYolo {
  /** URL do `model.onnx`. */
  url: string;
  /** Rotulo legivel para a interface/logs. */
  rotulo: string;
}

export const MODELOS_COCO_YOLO: Record<string, ModeloCocoYolo> = {
  "onnx-community/yolov10n": {
    url: "https://huggingface.co/onnx-community/yolov10n/resolve/main/onnx/model.onnx",
    rotulo: "YOLOv10 nano (ONNX)",
  },
  "onnx-community/yolov10s": {
    url: "https://huggingface.co/onnx-community/yolov10s/resolve/main/onnx/model.onnx",
    rotulo: "YOLOv10 small (ONNX)",
  },
};

/** Modelo padrao: o nano (rapido o suficiente para 4 frames por ciclo). */
export const MODELO_YOLO_PADRAO = "onnx-community/yolov10n";

/** Tipos minimos do onnxruntime-web (o pacote vem do CDN, fora do bundle). */
export interface TensorORT {
  data: Float32Array;
  dims: number[];
}

export interface SessaoORT {
  inputNames: string[];
  outputNames: string[];
  run(feeds: Record<string, TensorORT>): Promise<Record<string, TensorORT>>;
}

export interface RuntimeORT {
  InferenceSession: {
    create(url: string, opcoes?: Record<string, unknown>): Promise<SessaoORT>;
  };
  /** Os feeds de `run` precisam de instancias reais de `Tensor`. */
  Tensor: new (type: "float32", data: Float32Array, dims: number[]) => TensorORT;
  env: {
    wasm: {
      wasmPaths: string;
      /** Threads do WASM (exige `crossOriginIsolated`; ver `desempenho.ts`). */
      numThreads?: number;
    };
  };
}

/**
 * Contrato interno do motor de deteccao, consumido pelo adaptador. Existe para
 * que os testes possam falsificar o motor sem tocar em rede, e para manter o
 * adaptador desacoplado da classe concreta.
 */
export interface MotorDeteccao {
  readonly modelo: string | null;
  readonly dispositivo: "webgpu" | "wasm" | null;
  readonly tempoCargaMs: number | null;
  /**
   * Motivo do fallback worker -> thread principal, quando ocorreu. Fica `null`
   * enquanto a inferencia roda no worker e e preenchido **uma vez** por motor
   * (o fallback nao e repetido na mesma sessao). A telemetria usa esse campo
   * para distinguir "rodou no worker" de "caiu para a thread principal".
   */
  readonly motivoFallback?: string | null;
  aoStatus?: (mensagem: string) => void;
  carregar(modelo: string | null, aoStatus?: (mensagem: string) => void): Promise<void>;
  executar(imagem: string, opcoes?: OpcoesInferenciaYolo): Promise<DeteccaoYOLO[]>;
  /** Libera a sessao/recursos do runtime. Opcional: nem todo motor mantem recursos. */
  encerrar?(): void;
}
