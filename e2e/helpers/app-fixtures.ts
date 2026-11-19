import type { Page } from "@playwright/test";

export const CDN_TRANSFORMERS = /cdn\.jsdelivr\.net\/npm\/@huggingface\/transformers/;
export const CDN_ORT = /cdn\.jsdelivr\.net\/npm\/onnxruntime-web/;

export const STUB_TRANSFORMERS = `
export const env = {};
export async function pipeline() {
  return async () => [];
}
`;

/**
 * Runtime ONNX do detector (`public/yolo-onnx.ts`): sessao falsa com a mesma
 * superficie usada em producao (env, Tensor, InferenceSession.create/run). A
 * saida toda-zero [1, 300, 6] vira nenhuma deteccao, como o stub anterior do
 * transformers devolvia `[]`.
 */
export const STUB_ORT = `
export const env = { wasm: { wasmPaths: "" } };
export class Tensor {
  constructor(type, data, dims) {
    this.type = type;
    this.data = data;
    this.dims = dims;
  }
}
export const InferenceSession = {
  async create() {
    return {
      inputNames: ["images"],
      outputNames: ["output0"],
      async run() {
        const w = window;
        w.__deteccoes = (w.__deteccoes || 0) + 1;
        return { output0: new Tensor("float32", new Float32Array(300 * 6), [1, 300, 6]) };
      },
    };
  },
};
`;

/** Reproduz a queda do CDN de inferencia: a sessao do YOLO nao carrega. */
export const FALHA_ORT = `
export const env = { wasm: { wasmPaths: "" } };
export class Tensor {
  constructor(type, data, dims) {
    this.type = type;
    this.data = data;
    this.dims = dims;
  }
}
export const InferenceSession = {
  async create() {
    throw new Error("ORT indisponivel (offline)");
  },
};
`;

/** Inferencia lenta (2,5 s) com a instrumentacao dos testes de concorrencia. */
export const ORT_LENTO = `
export const env = { wasm: { wasmPaths: "" } };
export class Tensor {
  constructor(type, data, dims) {
    this.type = type;
    this.data = data;
    this.dims = dims;
  }
}
export const InferenceSession = {
  async create() {
    return {
      inputNames: ["images"],
      outputNames: ["output0"],
      async run() {
        const w = window;
        w.__deteccoes = (w.__deteccoes || 0) + 1;
        if (w.__emExecucao) w.__sobreposicoes = (w.__sobreposicoes || 0) + 1;
        w.__emExecucao = true;
        w.__inicios = w.__inicios || [];
        w.__inicios.push(Date.now());
        await new Promise((resolve) => setTimeout(resolve, 2500));
        w.__emExecucao = false;
        return { output0: new Tensor("float32", new Float32Array(300 * 6), [1, 300, 6]) };
      },
    };
  },
};
`;

export const ENTRADAS = [
  {
    timestamp: "2026-10-10T12:00:05.000Z",
    modelo: "qwen2.5-vl-3b-instruct",
    objetos: [],
    resumo: "Uma pessoa no escritorio.",
    tipo: "descricao",
  },
  {
    timestamp: "2026-10-10T12:00:00.000Z",
    modelo: "onnx-community/yolov10n",
    objetos: [
      { nome: "pessoa", rotulo: "person", score: 0.9, caixa: { xmin: 0, ymin: 0, xmax: 1, ymax: 1 } },
    ],
    resumo: "pessoa",
    tipo: "deteccao",
  },
];

export async function prepararPagina(
  page: Page,
  opcoes: { transformers?: string; ort?: string } = {}
): Promise<void> {
  // Forca o caminho do CDN: aborta as sondagens locais (`/vendor/`, `/modelos/`)
  // para que os testes sejam deterministicos mesmo com o modo offline baixado
  // na maquina de desenvolvimento.
  await page.route("**/vendor/**", (rota) => rota.abort("failed"));
  await page.route("**/modelos/**", (rota) => rota.abort("failed"));
  await page.route(CDN_TRANSFORMERS, (rota) =>
    rota.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: opcoes.transformers ?? STUB_TRANSFORMERS,
    })
  );
  await page.route(CDN_ORT, (rota) =>
    rota.fulfill({ status: 200, contentType: "text/javascript", body: opcoes.ort ?? STUB_ORT })
  );
  await page.route("**/api/health", (rota) =>
    rota.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        visao: {
          online: false,
          backend: "http://localhost:1234",
          modelo: "qwen2.5-vl-3b-instruct",
          modelos: [],
          carregados: [],
          erro: "desligado",
        },
      }),
    })
  );
  await page.route("**/api/logs**", (rota) => {
    if (rota.request().method() === "GET") {
      return rota.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, total: ENTRADAS.length, entradas: ENTRADAS }),
      });
    }
    return rota.continue();
  });
}

export async function instalarCameraFalsa(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      (window as unknown as { __testStream: MediaStream }).__testStream = stream;
      return stream;
    };
  });
}
