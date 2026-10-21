import { ErroPercepcao } from "../src/erros";
import { baseModelosLocal, caminhosOnnxRuntime, modelosDisponivel } from "./offline";

/**
 * Detector de objetos **YOLO em ONNX** — substitui os detectores transformer
 * (YOLOS/DETR via Transformers.js), que nao interessam ao produto.
 *
 * - Modelo: `onnx-community/yolov10*` (ultralytics YOLOv10, NMS-free), baixado
 *   do Hugging Face como `onnx/model.onnx`.
 * - Runtime: `onnxruntime-web` (WASM) vindo do CDN, como ja faziam
 *   Transformers.js e MediaPipe, e carregado **sob demanda**.
 * - Pre-pos-processamento (mesmo esquema do `preprocessor_config.json` do
 *   modelo): redimensiona (stretch) para 640x640, normaliza para [0,1] em RGB
 *   (float32, NCHW) e interpreta a saida `[1, 300, 6]` =
 *   (x1, y1, x2, y2, confianca, classe) em coordenadas do tensor 640x640,
 *   convertidas de volta para a resolucao original.
 *
 * O mesmo runtime/sessao e reaproveitado pelo detector NSFW experimental.
 */

/**
 * URLs locais (`/modelos/coco/...`) dos pesos. Quando `modelos/` esta servido
 * pelo servidor, o detector usa estes caminhos em vez do Hugging Face.
 */
const MODELOS_COCO_LOCAIS: Record<string, string> = {
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
  env: { wasm: { wasmPaths: string } };
}

const cacheRuntime: Record<string, Promise<RuntimeORT>> = {};

/**
 * Carrega (com cache) o `onnxruntime-web`, do servidor local quando o modo
 * offline esta preparado, senao do CDN.
 */
export async function carregarRuntimeYolo(): Promise<RuntimeORT> {
  const caminhos = await caminhosOnnxRuntime();
  const url = caminhos.modulo;
  if (!(url in cacheRuntime)) {
    cacheRuntime[url] = import(/* @vite-ignore */ url)
      .then((modulo: RuntimeORT & { default?: RuntimeORT }) => {
        const ort = (modulo.default ?? modulo) as RuntimeORT;
        // Os `.wasm` ficam ao lado do modulo; sem isso o runtime tenta baixar
        // de um caminho relativo inexistente.
        ort.env.wasm.wasmPaths = caminhos.wasmPaths;
        return ort;
      })
      .catch((erro: unknown) => {
        // Nao deixa promessa rejeitada no cache: se a rede voltar, a proxima
        // tentativa importa de novo.
        delete cacheRuntime[url];
        throw erro;
      });
  }
  return cacheRuntime[url];
}

const cacheSessoes: Record<string, Promise<SessaoORT>> = {};
/**
 * Contagem de referencias por URL: a sessao e compartilhada entre detectores
 * (COCO e NSFW) e so deve ser descartada quando o ultimo deles a libera. Sem
 * isso, encerrar um detector quebraria o outro que usa o mesmo modelo.
 */
const referenciasSessoes: Record<string, number> = {};

/**
 * Sessao de inferencia por URL (compartilhada por todos os detectores que
 * rodam no runtime — COCO e NSFW — para nao baixar/instanciar duas vezes).
 *
 * Cada chamada incrementa a contagem de referencias; o chamador deve parear
 * com `liberarSessaoYolo(url)` em `encerrar()`. `carregarRuntime` e injetavel
 * apenas para testes (default: o runtime real do CDN).
 */
export function obterSessaoYolo(
  url: string,
  carregarRuntime: () => Promise<RuntimeORT> = carregarRuntimeYolo
): Promise<SessaoORT> {
  referenciasSessoes[url] = (referenciasSessoes[url] ?? 0) + 1;
  if (!(url in cacheSessoes)) {
    cacheSessoes[url] = (async () => {
      const ort = await carregarRuntime();
      // `graphsOptimizationLevel: "all"` e o padrao; WebGPU nao e usado de
      // proposito: o WASM roda em qualquer navegador (inclusive no E2E).
      return ort.InferenceSession.create(url, { executionProviders: ["wasm"] });
    })().catch((erro: unknown) => {
      delete cacheSessoes[url];
      delete referenciasSessoes[url];
      throw new ErroPercepcao(
        "detector",
        `Falha ao carregar o modelo YOLO ONNX (${String(erro)}).`,
        { cause: erro }
      );
    });
  }
  return cacheSessoes[url];
}

/**
 * Libera uma referencia de sessao (pareamento com `obterSessaoYolo`). Quando o
 * ultimo detector que usa a URL a libera, a sessao e descartada de verdade
 * (`dispose`, quando o runtime suporta) e removida do cache — uma proxima
 * `carregar` baixa/instancia de novo, como esperado num encerramento real.
 */
export function liberarSessaoYolo(url: string): void {
  const atual = referenciasSessoes[url];
  if (atual === undefined) return;
  const restantes = atual - 1;
  if (restantes > 0) {
    referenciasSessoes[url] = restantes;
    return;
  }
  delete referenciasSessoes[url];
  const pendente = cacheSessoes[url];
  delete cacheSessoes[url];
  void pendente
    ?.then((sessao) => {
      const descartavel = sessao as SessaoORT & { dispose?: () => Promise<void> | void };
      void descartavel.dispose?.();
    })
    .catch(() => {
      // Sessao nunca carregou: nada a liberar.
    });
}

/** RGBA (canvas 640x640) -> tensor float32 NCHW [1, 3, lado, lado] em [0, 1]. */
export function rgbaParaTensorNCHW(
  rgba: Uint8ClampedArray,
  lado: number = LADO_ENTRADA_YOLO
): Float32Array {
  const plano = lado * lado;
  const dados = new Float32Array(3 * plano);
  for (let i = 0; i < plano; i++) {
    dados[i] = rgba[i * 4] / 255;
    dados[plano + i] = rgba[i * 4 + 1] / 255;
    dados[2 * plano + i] = rgba[i * 4 + 2] / 255;
  }
  return dados;
}

/**
 * Interpreta a saida do YOLOv10/v11 (`[1, 300, 6]`, NMS-free) e devolve caixas
 * na resolucao original. Aceita tambem a forma transposta `[1, 6, 300]`, caso
 * o export do modelo mude. `rotulos` permite reaproveitar o mesmo interpretador
 * para modelos fora do COCO (ex.: o detector NSFW experimental); a ordem
 * corresponde aos ids de classe do modelo exportado.
 */
export function interpretarSaidaYolo(
  cru: Float32Array,
  dims: number[],
  limiar: number,
  larguraOriginal: number,
  alturaOriginal: number,
  lado: number = LADO_ENTRADA_YOLO,
  rotulos: readonly string[] = COCO_INGLES
): DeteccaoYOLO[] {
  if (dims.length < 2) {
    throw new ErroPercepcao("detector", `Saida inesperada do YOLO: dims=${dims.join("x")}.`);
  }
  const transposto = dims[1] === 6;
  const colunas = transposto ? 6 : dims[dims.length - 1];
  const linhas = transposto ? dims[dims.length - 1] : dims[dims.length - 2];
  if (colunas < 6) {
    throw new ErroPercepcao("detector", `Saida inesperada do YOLO: dims=${dims.join("x")}.`);
  }
  const indice = (linha: number, coluna: number) =>
    transposto ? coluna * linhas + linha : linha * colunas + coluna;

  const ex = larguraOriginal / lado;
  const ey = alturaOriginal / lado;
  const deteccoes: DeteccaoYOLO[] = [];
  for (let i = 0; i < linhas; i++) {
    const score = cru[indice(i, 4)];
    if (!(score >= limiar)) continue;
    const classe = Math.round(cru[indice(i, 5)]);
    const xmin = Math.max(0, Math.min(larguraOriginal, cru[indice(i, 0)] * ex));
    const ymin = Math.max(0, Math.min(alturaOriginal, cru[indice(i, 1)] * ey));
    const xmax = Math.max(0, Math.min(larguraOriginal, cru[indice(i, 2)] * ex));
    const ymax = Math.max(0, Math.min(alturaOriginal, cru[indice(i, 3)] * ey));
    if (xmax <= xmin || ymax <= ymin) continue;
    deteccoes.push({
      label: rotulos[classe] ?? `classe ${classe}`,
      score,
      box: { xmin, ymin, xmax, ymax },
    });
  }
  return deteccoes;
}

/** Decodifica uma imagem em data URL/base64 num bitmap do navegador. */
export async function decodificarImagem(dataUrl: string): Promise<ImageBitmap> {
  try {
    const resposta = await fetch(dataUrl);
    return await createImageBitmap(await resposta.blob());
  } catch (erro) {
    throw new ErroPercepcao("detector", `Nao foi possivel decodificar o frame (${String(erro)}).`, {
      cause: erro,
    });
  }
}

/** Redimensiona (stretch) o bitmap para o lado de entrada e extrai os pixels. */
export function rasterizar(bitmap: ImageBitmap, lado: number): Uint8ClampedArray {
  const canvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(lado, lado)
      : Object.assign(document.createElement("canvas"), { width: lado, height: lado });
  const contexto = canvas.getContext("2d", { willReadFrequently: true });
  if (!contexto) throw new ErroPercepcao("detector", "Canvas 2D indisponivel para o YOLO.");
  contexto.drawImage(bitmap, 0, 0, lado, lado);
  return contexto.getImageData(0, 0, lado, lado).data;
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
  aoStatus?: (mensagem: string) => void;
  carregar(modelo: string | null, aoStatus?: (mensagem: string) => void): Promise<void>;
  executar(imagem: string, opcoes?: OpcoesInferenciaYolo): Promise<DeteccaoYOLO[]>;
  /** Libera a sessao/recursos do runtime. Opcional: nem todo motor mantem recursos. */
  encerrar?(): void;
}

/** Detector COCO via YOLO ONNX (mesmo contrato interno do antigo detector). */
export class DetectorYoloOnnx implements MotorDeteccao {
  modelo: string | null = null;
  /** O onnxruntime-web roda em WASM (sem WebGPU) por decisao de compatibilidade. */
  dispositivo = "wasm" as const;
  tempoCargaMs: number | null = null;
  aoStatus?: (mensagem: string) => void;

  private sessao: SessaoORT | null = null;
  private runtime: RuntimeORT | null = null;
  private urlModelo: string | null = null;

  /** Resolve a chave do catalogo (ou uma URL direta) para o `model.onnx`. */
  static resolverUrl(modelo: string | null | undefined): string {
    const chave = modelo?.trim() || MODELO_YOLO_PADRAO;
    const catalogo = MODELOS_COCO_YOLO[chave];
    if (catalogo) return catalogo.url;
    if (chave.startsWith("http")) return chave;
    return MODELOS_COCO_YOLO[MODELO_YOLO_PADRAO].url;
  }

  /**
   * Como `resolverUrl`, mas prefere o caminho local (`/modelos/coco/...`) quando
   * o modo offline esta preparado. URLs diretas informadas pelo usuario nao sao
   * trocadas.
   */
  static async resolverUrlOffline(modelo: string | null | undefined): Promise<string> {
    const chave = modelo?.trim() || MODELO_YOLO_PADRAO;
    if (chave.startsWith("http")) return chave;
    if (await modelosDisponivel()) {
      const local = MODELOS_COCO_LOCAIS[chave] ?? MODELOS_COCO_LOCAIS[MODELO_YOLO_PADRAO];
      return `${baseModelosLocal()}/${local}`;
    }
    return DetectorYoloOnnx.resolverUrl(chave);
  }

  async carregar(modelo: string | null, aoStatus?: (mensagem: string) => void): Promise<void> {
    if (aoStatus) this.aoStatus = aoStatus;
    const chave = modelo?.trim() || null;
    const url = await DetectorYoloOnnx.resolverUrlOffline(chave);
    if (this.sessao && this.urlModelo === url) return;
    const inicio = performance.now();
    this.aoStatus?.("carregando");
    this.sessao = await obterSessaoYolo(url);
    this.runtime = await carregarRuntimeYolo();
    this.urlModelo = url;
    this.modelo =
      chave && (chave in MODELOS_COCO_YOLO || chave.startsWith("http"))
        ? chave
        : MODELO_YOLO_PADRAO;
    this.tempoCargaMs = Math.round(performance.now() - inicio);
    this.aoStatus?.("pronto");
  }

  /** Inferencia sobre um frame (data URL), com caixas em pixels. */
  async executar(
    imagem: string,
    opcoes?: OpcoesInferenciaYolo
  ): Promise<DeteccaoYOLO[]> {
    if (!this.sessao || !this.runtime) {
      throw new ErroPercepcao("detector", "Detector YOLO nao carregado.");
    }
    const limiar = opcoes?.threshold ?? 0.5;
    const bitmap = await decodificarImagem(imagem);
    try {
      const larguraOriginal = bitmap.width;
      const alturaOriginal = bitmap.height;
      const rgba = rasterizar(bitmap, LADO_ENTRADA_YOLO);
      const dados = rgbaParaTensorNCHW(rgba);
      const sessao = this.sessao;
      const entrada = sessao.inputNames[0];
      const saida = sessao.outputNames[0];
      // Os feeds exigem instancias de `ort.Tensor` (validado em
      // `scripts/verificar-yolo-onnx.mjs`, que roda o mesmo caminho).
      const feeds: Record<string, TensorORT> = {
        [entrada]: new this.runtime.Tensor("float32", dados, [
          1,
          3,
          LADO_ENTRADA_YOLO,
          LADO_ENTRADA_YOLO,
        ]),
      };
      const resultado = await sessao.run(feeds);
      const tensor = resultado[saida];
      if (!tensor) throw new ErroPercepcao("detector", "Saida do YOLO vazia.");
      const deteccoes = interpretarSaidaYolo(
        tensor.data,
        tensor.dims,
        limiar,
        larguraOriginal,
        alturaOriginal
      );
      if (opcoes?.percentage) {
        for (const d of deteccoes) {
          d.box.xmin /= larguraOriginal;
          d.box.ymin /= alturaOriginal;
          d.box.xmax /= larguraOriginal;
          d.box.ymax /= alturaOriginal;
        }
      }
      return deteccoes;
    } finally {
      bitmap.close();
    }
  }

  /**
   * Libera a referencia desta instancia a sessao compartilhada. A sessao so e
   * descartada de fato quando nenhum outro detector (COCO/NSFW) usa a mesma URL
   * (contagem de referencias em `obterSessaoYolo`/`liberarSessaoYolo`).
   */
  encerrar(): void {
    if (this.urlModelo) liberarSessaoYolo(this.urlModelo);
    this.sessao = null;
    this.runtime = null;
    this.urlModelo = null;
    this.modelo = null;
  }
}
