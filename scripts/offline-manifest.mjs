#!/usr/bin/env node

/**
 * Manifesto do modo offline: onde cada biblioteca e peso e obtido na internet e
 * onde ele deve ficar servido pelo servidor Node.
 *
 * Fonte unica para `scripts/preparar-offline.mjs` (download) — as pastas
 * `vendor/` e `modelos/` sao **gitignored**, como `yolonsfw/`.
 *
 * Estrutura servida (mesmas rotas de `/yolonsfw/`, em `src/server.ts`):
 *   vendor/mediapipe/     bundle ESM do tasks-vision + /wasm
 *   vendor/transformers/  bundle ESM do Transformers.js + wasm jsep
 *   vendor/onnxruntime/   ort.min.mjs + wasm + glue dos workers
 *   modelos/coco/         yolov10n.onnx / yolov10s.onnx
 *   modelos/pose/         pastas dos repos Xenova/yolov8*-pose (configs + onnx)
 *   modelos/maos/         gesture_recognizer.task
 *
 * As versoes aqui **precisam casar** com as URLs fixadas no cliente
 * (`public/gestos.ts`, `public/pose.ts`, `public/yolo-onnx.ts`). Ao subir uma
 * versao, mude nos dois lugares.
 */

/** Versoes fixas dos runtimes carregados do CDN. */
export const VERSOES = {
  mediapipe: "0.10.21",
  transformers: "3.8.1",
  onnxruntime: "1.21.0",
};

/** ID do repositório de pose no Hugging Face por chave da interface. */
export const REPOS_POSE = {
  "Xenova/yolov8n-pose": [
    "config.json",
    "preprocessor_config.json",
    "onnx/model.onnx",
    "onnx/model_quantized.onnx",
  ],
  "Xenova/yolov8s-pose": [
    "config.json",
    "preprocessor_config.json",
    "onnx/model.onnx",
    "onnx/model_quantized.onnx",
  ],
};

const CDN = (pacote, versao) => `https://cdn.jsdelivr.net/npm/${pacote}@${versao}`;
const HF = (repo, arquivo) => `https://huggingface.co/${repo}/resolve/main/${arquivo}`;

/**
 * Bibliotecas e seus arquivos. `origem` = URL no CDN; `destino` = caminho
 * relativo a `vendor/` (servido em `/vendor/`).
 */
export const BIBLIOTECAS = [
  {
    nome: "MediaPipe Tasks Vision",
    itens: [
      { origem: `${CDN("@mediapipe/tasks-vision", VERSOES.mediapipe)}/vision_bundle.mjs`, destino: "mediapipe/vision_bundle.mjs" },
      { origem: `${CDN("@mediapipe/tasks-vision", VERSOES.mediapipe)}/wasm/vision_wasm_internal.js`, destino: "mediapipe/wasm/vision_wasm_internal.js" },
      { origem: `${CDN("@mediapipe/tasks-vision", VERSOES.mediapipe)}/wasm/vision_wasm_internal.wasm`, destino: "mediapipe/wasm/vision_wasm_internal.wasm" },
      { origem: `${CDN("@mediapipe/tasks-vision", VERSOES.mediapipe)}/wasm/vision_wasm_nosimd_internal.js`, destino: "mediapipe/wasm/vision_wasm_nosimd_internal.js" },
      { origem: `${CDN("@mediapipe/tasks-vision", VERSOES.mediapipe)}/wasm/vision_wasm_nosimd_internal.wasm`, destino: "mediapipe/wasm/vision_wasm_nosimd_internal.wasm" },
    ],
  },
  {
    nome: "Transformers.js",
    itens: [
      { origem: `${CDN("@huggingface/transformers", VERSOES.transformers)}/dist/transformers.min.js`, destino: "transformers/transformers.min.js" },
      // Transformers.js usa o proprio runtime ORT (jsep). Sem estes dois o
      // backend WASM do bundle nao inicializa.
      { origem: `${CDN("@huggingface/transformers", VERSOES.transformers)}/dist/ort-wasm-simd-threaded.jsep.mjs`, destino: "transformers/ort-wasm-simd-threaded.jsep.mjs" },
      { origem: `${CDN("@huggingface/transformers", VERSOES.transformers)}/dist/ort-wasm-simd-threaded.jsep.wasm`, destino: "transformers/ort-wasm-simd-threaded.jsep.wasm" },
    ],
  },
  {
    nome: "onnxruntime-web",
    itens: [
      { origem: `${CDN("onnxruntime-web", VERSOES.onnxruntime)}/dist/ort.min.mjs`, destino: "onnxruntime/ort.min.mjs" },
      { origem: `${CDN("onnxruntime-web", VERSOES.onnxruntime)}/dist/ort-wasm-simd-threaded.mjs`, destino: "onnxruntime/ort-wasm-simd-threaded.mjs" },
      { origem: `${CDN("onnxruntime-web", VERSOES.onnxruntime)}/dist/ort-wasm-simd-threaded.wasm`, destino: "onnxruntime/ort-wasm-simd-threaded.wasm" },
      { origem: `${CDN("onnxruntime-web", VERSOES.onnxruntime)}/dist/ort-wasm-simd-threaded.jsep.mjs`, destino: "onnxruntime/ort-wasm-simd-threaded.jsep.mjs" },
      { origem: `${CDN("onnxruntime-web", VERSOES.onnxruntime)}/dist/ort-wasm-simd-threaded.jsep.wasm`, destino: "onnxruntime/ort-wasm-simd-threaded.jsep.wasm" },
    ],
  },
];

/**
 * Pesos dos modelos. `destino` = caminho relativo a `modelos/` (servido em
 * `/modelos/`). Os nomes casam com as URLs montadas em `public/offline.ts`.
 */
export const PESOS = [
  {
    nome: "YOLO COCO (deteccao)",
    itens: [
      { origem: HF("onnx-community/yolov10n", "onnx/model.onnx"), destino: "coco/yolov10n.onnx" },
      { origem: HF("onnx-community/yolov10s", "onnx/model.onnx"), destino: "coco/yolov10s.onnx" },
    ],
  },
  {
    nome: "YOLO Pose (esqueleto)",
    itens: Object.entries(REPOS_POSE).flatMap(([repo, arquivos]) =>
      arquivos.map((arquivo) => ({
        origem: HF(repo, arquivo),
        // O Transformers.js monta `localModelPath + idModelo`: o id inclui a
        // org (`Xenova/...`), entao a pasta local tambem precisa dela.
        destino: `pose/${repo}/${arquivo}`,
      }))
    ),
  },
  {
    nome: "MediaPipe Gesture Recognizer (maos)",
    itens: [
      {
        origem:
          "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
        destino: "maos/gesture_recognizer.task",
      },
    ],
  },
];
