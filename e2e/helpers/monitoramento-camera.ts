import type { Page } from "@playwright/test";

const CDN_TRANSFORMERS = /cdn\.jsdelivr\.net\/npm\/@huggingface\/transformers/;
const CDN_ORT = /cdn\.jsdelivr\.net\/npm\/onnxruntime-web/;

const STUB_TRANSFORMERS = `
export const env = {};
export async function pipeline() {
  return async () => [];
}
`;

/** Mesma superficie do stub de app.spec.ts: saida [1, 300, 6] toda-zero. */
const STUB_ORT = `
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
        return { output0: new Tensor("float32", new Float32Array(300 * 6), [1, 300, 6]) };
      },
    };
  },
};
`;

const ENTRADAS = [
  {
    timestamp: "2026-10-10T12:00:05.000Z",
    modelo: "qwen2.5-vl-3b-instruct",
    objetos: [],
    resumo: "Uma pessoa no escritorio.",
    tipo: "descricao",
  },
];

/** Copia o minimo de `prepararPagina` de app.spec.ts (nao e exportado). */
export async function prepararPagina(page: Page): Promise<void> {
  await page.route("**/vendor/**", (rota) => rota.abort("failed"));
  await page.route("**/modelos/**", (rota) => rota.abort("failed"));
  await page.route(CDN_TRANSFORMERS, (rota) =>
    rota.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: STUB_TRANSFORMERS,
    })
  );
  await page.route(CDN_ORT, (rota) =>
    rota.fulfill({ status: 200, contentType: "text/javascript", body: STUB_ORT })
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

export type JanelaCameraFalsa = Window & {
  __testStreams: MediaStream[];
  __cameraCalls: number;
  __canvasCamera: HTMLCanvasElement[];
  __intervalosCamera: number[];
};

/**
 * Versao de `instalarCameraFalsa` que devolve streams de canvas capturado a
 * 10 FPS, mantendo o canvas vivo e registrando cada chamada/stream na janela.
 */
export async function instalarCameraFalsaComStreams(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as JanelaCameraFalsa;
    w.__testStreams = [];
    w.__cameraCalls = 0;
    w.__canvasCamera = [];
    w.__intervalosCamera = [];

    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 240;
      const ctx = canvas.getContext("2d");
      let quadro = 0;
      const desenhar = () => {
        if (!ctx) return;
        ctx.fillStyle = `hsl(${(quadro * 37) % 360}, 70%, 50%)`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect((quadro * 7) % 280, 20, 40, 40);
        quadro += 1;
      };
      desenhar();
      // Mantem atualizando os pixels para o video (e o MediaRecorder) terem sinal.
      w.__intervalosCamera.push(window.setInterval(desenhar, 50));
      w.__canvasCamera.push(canvas);

      const stream = canvas.captureStream(10);
      w.__testStreams.push(stream);
      w.__cameraCalls += 1;
      return stream;
    };
  });
}

export type CorpoOperacional = {
  nivel?: string;
  origem?: string;
  mensagem?: string;
  detalhe?: string;
};

export type Sessao = {
  sessaoId: string;
  ambiente: string;
  estado: string;
};

export type Segmento = {
  segmentoId: string;
  sessaoId: string;
  sequencia: number;
  quadros: number;
  estado: string;
  motivoFim?: string;
  lacunas: Array<{ motivo: string; duracaoMs: number }>;
};

export function corpoComoObjeto(valor: unknown): CorpoOperacional | null {
  if (valor && typeof valor === "object") return valor as CorpoOperacional;
  if (typeof valor === "string") {
    try {
      return JSON.parse(valor) as CorpoOperacional;
    } catch {
      return null;
    }
  }
  return null;
}

export function textoOperacional(registro: CorpoOperacional): string {
  return [registro.mensagem, registro.detalhe, registro.origem]
    .filter((parte): parte is string => typeof parte === "string")
    .join(" ");
}
