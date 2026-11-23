/**
 * Detector de objetos **YOLO em ONNX** — substitui os detectores transformer
 * (YOLOS/DETR via Transformers.js), que nao interessam ao produto.
 *
 * - Modelo: `onnx-community/yolov10*` (ultralytics YOLOv10, NMS-free), baixado
 *   do Hugging Face como `onnx/model.onnx`.
 * - Runtime: `onnxruntime-web` (WASM) vindo do CDN, como ja faziam
 *   Transformers.js e MediaPipe, e carregado **sob demanda**.
 * - Pre-pos-processamento implementado no cliente: redimensiona (stretch) para
 *   640x640, normaliza para [0,1] em RGB (float32, NCHW) e interpreta a saida
 *   `[1, 300, 6]` = (x1, y1, x2, y2, confianca, classe) em coordenadas do tensor
 *   640x640, convertidas de volta para a resolucao original. Nao ha um
 *   `preprocessor_config.json` versionado para estes pesos: a afirmacao de que
 *   este caminho e identico a referencia de treinamento permanece pendente de
 *   verificacao com os pesos/referencia Python (ver `docs/nsfw.md`).
 *
 * O mesmo runtime/sessao e reaproveitado pelo detector NSFW experimental.
 */

export {
  COCO_INGLES,
  LADO_ENTRADA_YOLO,
  MODELOS_COCO_YOLO,
  MODELO_YOLO_PADRAO,
  type CaixaYOLO,
  type DeteccaoYOLO,
  type ModeloCocoYolo,
  type MotorDeteccao,
  type OpcoesInferenciaYolo,
  type RuntimeORT,
  type SessaoORT,
  type TensorORT,
} from "./yolo-onnx/tipos";
export {
  carregarRuntimeYolo,
  dispositivoSessaoYolo,
  liberarSessaoYolo,
  obterSessaoYolo,
} from "./yolo-onnx/sessao";
export {
  decodificarImagem,
  interpretarSaidaYolo,
  rasterizar,
  rgbaParaTensorNCHW,
} from "./yolo-onnx/imagem";
export { DetectorYoloOnnx } from "./yolo-onnx/detector";
