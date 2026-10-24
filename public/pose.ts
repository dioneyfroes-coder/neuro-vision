import { ErroPercepcao } from "../src/erros";
import type { CriadorMotorPose } from "./perception/adapters/pose-estimator.adapter";
import type {
  ProgressInfo,
  Tensor,
} from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";
import { baseModelosLocal, modelosDisponivel, moduloTransformers } from "./offline";
import { threadsWasm, webgpuDisponivel } from "./desempenho";

/**
 * Motor de pose (YOLO Pose via Transformers.js) — Etapa 5 do roteiro.
 *
 * Este e o modulo **especifico do SDK**: carrega o modelo `Xenova/yolov8*-pose`
 * pelo CDN e traduz a saida crua (tensor `output0`, shape `[1, 56, 8400]`) em
 * keypoints na resolucao original da imagem + dimensoes. O adaptador
 * `AdaptadorPose` normaliza esses keypoints para [0, 1] — a matematica de
 * normalizacao nao vive aqui.
 *
 * A URL fica literal no `import()` para o vite/vitest aplicarem o alias de teste
 * e o esbuild manter o carregamento externo (mesmo padrao de `public/detector.ts`).
 * Como o modelo real so e baixado em um navegador com rede, os testes unitarios
 * exercitam a normalizacao com um motor falso injetado, nunca este modulo.
 */

/** Modelo de pose padrao: YOLOv8 nano (COCO keypoints, 17 pontos). */
export const MODELO_POSE_PADRAO = "Xenova/yolov8n-pose";

/** Confianca minima para manter uma pessoa detectada (model card do YOLO Pose). */
const LIMIAR_SCORE = 0.3;

/** 17 keypoints COCO, cada um com (x, y, visibilidade), apos os 4 da caixa + score. */
const OFFSET_KEYPOINTS = 5;
const PASSO_KEYPOINT = 3;

interface OpcoesModelo {
  progress_callback?: (info: ProgressInfo) => void;
  /** `webgpu`/`wasm` (Transformers.js escolhe o backend do ONNX Runtime). */
  device?: string;
  /** Tipo dos pesos: `fp32` casa com o `model.onnx` local. */
  dtype?: string;
}

interface ModuloTransformers {
  AutoModel: {
    from_pretrained(
      modelo: string,
      opcoes?: OpcoesModelo
    ): Promise<(entrada: { images: Tensor }) => Promise<{ output0: Tensor }>>;
  };
  AutoProcessor: {
    from_pretrained(
      modelo: string,
      opcoes?: { progress_callback?: (info: ProgressInfo) => void }
    ): Promise<(imagem: unknown) => Promise<{ pixel_values: Tensor }>>;
  };
  RawImage: {
    read(entrada: string): Promise<{ width: number; height: number }>;
  };
  env: {
    allowLocalModels: boolean;
    useBrowserCache: boolean;
    localModelPath: string;
    remoteHost: string;
    backends?: {
      onnx?: {
        wasm?: {
          numThreads?: number;
        };
      };
    };
  };
}

let promessaModulo: Promise<ModuloTransformers> | null = null;

async function carregarTransformers(): Promise<ModuloTransformers> {
  if (promessaModulo === null) {
    const url = await moduloTransformers();
    promessaModulo = import(/* @vite-ignore */ url)
      .then(async (mod) => {
        const local = await modelosDisponivel();
        mod.env.allowLocalModels = local;
        mod.env.useBrowserCache = true;
        // Threads do WASM (pose roda em worker dedicado; ver `desempenho.ts`).
        if (mod.env.backends?.onnx?.wasm) {
          mod.env.backends.onnx.wasm.numThreads = threadsWasm();
        }
        if (local) {
          // Carrega os pesos do proprio servidor (`/modelos/pose/...`).
          mod.env.localModelPath = `${baseModelosLocal()}/pose/`;
        } else {
          // Fallback: baixa do Hugging Face, como antes do modo offline.
          mod.env.remoteHost = "https://huggingface.co";
        }
        return mod as ModuloTransformers;
      })
      .catch((err) => {
        // Nao guarda promessa rejeitada: a proxima tentativa recarrega.
        promessaModulo = null;
        throw err;
      });
  }
  return promessaModulo;
}

function mensagemDe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Cria o motor de pose do Transformers.js para o modelo informado. */
export const criarMotorPoseTransformers: CriadorMotorPose = async (modelo, aoStatus) => {
  const idModelo = modelo || MODELO_POSE_PADRAO;
  const progresso = (info: ProgressInfo): void => {
    if (info.status === "progress" && info.file) {
      const pct = info.progress ? Math.round(info.progress) : 0;
      aoStatus?.(`Baixando ${info.file}... ${pct}%`);
    }
  };

  aoStatus?.(`Carregando modelo de pose ${idModelo}...`);
  let modulo: ModuloTransformers;
  try {
    modulo = await carregarTransformers();
  } catch (err) {
    throw new ErroPercepcao("detector", `falha ao carregar Transformers.js: ${mensagemDe(err)}`, {
      cause: err,
    });
  }

  try {
    const processor = modulo.AutoProcessor.from_pretrained(idModelo, {
      progress_callback: progresso,
    });
    let dispositivo: "webgpu" | "wasm" = "wasm";
    let model: Awaited<ReturnType<ModuloTransformers["AutoModel"]["from_pretrained"]>> | null =
      null;
    if (webgpuDisponivel()) {
      try {
        model = await modulo.AutoModel.from_pretrained(idModelo, {
          progress_callback: progresso,
          device: "webgpu",
          dtype: "fp32",
        });
        dispositivo = "webgpu";
      } catch (erro) {
        aoStatus?.(
          `WebGPU indisponivel para pose (${mensagemDe(erro)}); usando WASM.`
        );
      }
    }
    if (!model) {
      model = await modulo.AutoModel.from_pretrained(idModelo, {
        progress_callback: progresso,
      });
    }
    const processorPronto = await processor;

    return {
      dispositivo,
      versao: "3.8.1",
      async executar(imagem) {
        const crua = await modulo.RawImage.read(imagem);
        const { pixel_values } = await processorPronto(crua);
        const { output0 } = await model({ images: pixel_values });

        // `pixel_values` costuma vir com o lado maior redimensionado (ex.: 640).
        const dims = pixel_values.dims;
        const alturaEscalada = dims[dims.length - 2] || 1;
        const larguraEscalada = dims[dims.length - 1] || 1;

        // output0: [1, 56, N] -> [N, 56]: 4 caixa + 1 score + 17 * 3 keypoints.
        const linhas = output0[0].transpose(1, 0).tolist() as number[][];
        const pessoas: {
          keypoints: { x: number; y: number; confianca?: number }[];
          confianca?: number;
        }[] = [];

        for (const linha of linhas) {
          const score = linha[4] ?? 0;
          if (score < LIMIAR_SCORE) continue;

          const keypoints: { x: number; y: number; confianca?: number }[] = [];
          for (let i = OFFSET_KEYPOINTS; i + 2 < linha.length; i += PASSO_KEYPOINT) {
            keypoints.push({
              // Escala os keypoints do espaco redimensionado para a imagem original.
              x: ((linha[i] ?? 0) / larguraEscalada) * crua.width,
              y: ((linha[i + 1] ?? 0) / alturaEscalada) * crua.height,
              confianca: linha[i + 2],
            });
          }
          pessoas.push({ keypoints, confianca: score });
        }

        return {
          pessoas,
          dimensoes: { largura: crua.width, altura: crua.height },
        };
      },
    };
  } catch (err) {
    throw new ErroPercepcao("detector", `falha ao iniciar o estimador de pose: ${mensagemDe(err)}`, {
      cause: err,
    });
  }
};
