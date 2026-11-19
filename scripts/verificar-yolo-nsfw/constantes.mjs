import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR_MODULO = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(DIR_MODULO, "../..");
export const DIST_ORT = path.join(ROOT, "node_modules", "onnxruntime-web", "dist");
export const DIR_PESOS = path.join(ROOT, "modelos", "yolonsfw");

export const MIME_ENTRADAS = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};
export const EXTENSOES_VIDEO = new Set([".mp4", ".webm"]);
export const MIME = {
  ".mjs": "application/javascript",
  ".js": "application/javascript",
  ".wasm": "application/wasm",
  ".onnx": "application/octet-stream",
  ".json": "application/json",
  ...MIME_ENTRADAS,
  ".html": "text/html; charset=utf-8",
};

/** Pagina estatica servida em `/`; antes era o template literal `PAGINA`. */
export const PAGINA_HTML = path.join(DIR_MODULO, "pagina.html");

/** Modelos do conjunto NSFW, na mesma ordem de `public/nsfw-onnx.ts`. */
export const MODELOS_CONJUNTO = [
  "nudenet_320n",
  "nudenet_640m",
  "erax_nsfw_yolo11n",
  "erax_nsfw_yolo11s",
  "erax_nsfw_yolo11m",
  "penis_yolov8m",
];