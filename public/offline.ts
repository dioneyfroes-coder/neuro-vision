/**
 * Resolucao de dependencias externas para o **modo offline**.
 *
 * O servidor pode servir bibliotecas e pesos localmente (`vendor/` e `modelos/`,
 * baixados por `scripts/preparar-offline.mjs`, ambos gitignored). Este modulo
 * decide, em tempo de execucao, se usa os caminhos locais ou cai para o **CDN**
 * como fallback — assim quem nao rodou o script continua funcionando.
 *
 * A deteccao e feita com um `HEAD` unico por area (bibliotecas/pesos) e o
 * resultado fica em cache na sessao. Nenhuma promessa rejeitada e guardada:
 * se a rede voltar, uma proxima tentativa reavalia.
 */

/** Versoes fixas — precisam casar com `scripts/offline-manifest.mjs`. */
export const VERSAO_MEDIAPIPE = "0.10.21";
export const VERSAO_TRANSFORMERS = "3.8.1";
export const VERSAO_ONNXRUNTIME = "1.21.0";

const CDN = "https://cdn.jsdelivr.net/npm";

/**
 * Bases locais servidas pelo servidor (`src/server.ts`). O cliente usa caminhos
 * absolutos, entao funcionam tanto em `http://127.0.0.1:3000` quanto atras de
 * um proxy que preserve `/vendor/` e `/modelos/`.
 */
export const BASE_VENDOR_LOCAL = "/vendor";
export const BASE_MODELOS_LOCAL = "/modelos";

/** Bases do CDN (fallback). */
export const BASE_MEDIAPIPE_CDN = `${CDN}/@mediapipe/tasks-vision@${VERSAO_MEDIAPIPE}`;
export const BASE_TRANSFORMERS_CDN = `${CDN}/@huggingface/transformers@${VERSAO_TRANSFORMERS}`;
export const BASE_ONNXRUNTIME_CDN = `${CDN}/onnxruntime-web@${VERSAO_ONNXRUNTIME}`;

let cacheVendor: Promise<boolean> | null = null;
let cacheModelos: Promise<boolean> | null = null;

/**
 * Um `HEAD` num arquivo conhecido de cada area diz se ela foi baixada.
 *
 * Resolve `false` quando o servidor respondeu (arquivo ausente = nao baixado) e
 * **rejeita** em falha de rede — assim o cache nao guarda um resultado negativo
 * causado por uma indisponibilidade momentanea.
 */
function existeLocal(url: string): Promise<boolean> {
  return fetch(url, { method: "HEAD" }).then((r) => r.ok);
}

/** `true` se `vendor/` foi baixado e esta sendo servido localmente. */
export function vendorDisponivel(): Promise<boolean> {
  if (cacheVendor === null) {
    cacheVendor = existeLocal(`${BASE_VENDOR_LOCAL}/mediapipe/vision_bundle.mjs`).catch(() => {
      cacheVendor = null;
      return false;
    });
  }
  return cacheVendor;
}

/** `true` se `modelos/` foi baixado e esta sendo servido localmente. */
export function modelosDisponivel(): Promise<boolean> {
  if (cacheModelos === null) {
    cacheModelos = existeLocal(`${BASE_MODELOS_LOCAL}/coco/yolov10n.onnx`).catch(() => {
      cacheModelos = null;
      return false;
    });
  }
  return cacheModelos;
}

/** MediaPipe (mãos/gestos): bundle ESM + diretorio `/wasm`. */
export interface CaminhosMediaPipe {
  modulo: string;
  wasm: string;
  /** `true` quando servido localmente (para diagnostico/telemetria). */
  local: boolean;
}

export async function caminhosMediaPipe(): Promise<CaminhosMediaPipe> {
  if (await vendorDisponivel()) {
    return {
      modulo: `${BASE_VENDOR_LOCAL}/mediapipe/vision_bundle.mjs`,
      wasm: `${BASE_VENDOR_LOCAL}/mediapipe/wasm`,
      local: true,
    };
  }
  return {
    modulo: `${BASE_MEDIAPIPE_CDN}/vision_bundle.mjs`,
    wasm: `${BASE_MEDIAPIPE_CDN}/wasm`,
    local: false,
  };
}

/** Transformers.js (pose): bundle ESM. */
export async function moduloTransformers(): Promise<string> {
  if (await vendorDisponivel()) {
    return `${BASE_VENDOR_LOCAL}/transformers/transformers.min.js`;
  }
  return BASE_TRANSFORMERS_CDN;
}

/** onnxruntime-web (deteccao/NSFW): modulo + diretorio dos `.wasm`. */
export interface CaminhosOnnxRuntime {
  modulo: string;
  wasmPaths: string;
  local: boolean;
}

export async function caminhosOnnxRuntime(): Promise<CaminhosOnnxRuntime> {
  if (await vendorDisponivel()) {
    return {
      modulo: `${BASE_VENDOR_LOCAL}/onnxruntime/ort.min.mjs`,
      wasmPaths: `${BASE_VENDOR_LOCAL}/onnxruntime/`,
      local: true,
    };
  }
  return {
    modulo: `${BASE_ONNXRUNTIME_CDN}/dist/ort.min.mjs`,
    wasmPaths: `${BASE_ONNXRUNTIME_CDN}/dist/`,
    local: false,
  };
}

/** Pasta raiz dos pesos servidos localmente (`/modelos/`). */
export function baseModelosLocal(): string {
  return BASE_MODELOS_LOCAL;
}

/** Limpa o cache de deteccao (util em testes e apos recarregar as pastas). */
export function limparCacheOffline(): void {
  cacheVendor = null;
  cacheModelos = null;
}
