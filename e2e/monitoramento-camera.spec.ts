import { expect, test, type Page } from "@playwright/test";

/**
 * E2E da queda/retorno REAL de MediaStream (Fase 6).
 *
 * Diferente dos testes unitarios, aqui o `getUserMedia` do navegador e
 * substituido por `canvas.captureStream(10)`: a trilha de video da PRIMEIRA
 * stream e efetivamente interrompida e a camera reconecta com uma stream nova.
 * As rotas `/api/monitoramento/*` NAO sao stubadas — o servidor real do
 * `webServer` do Playwright e usado para as assercoes do contrato HTTP.
 */

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
async function prepararPagina(page: Page): Promise<void> {
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

type JanelaCameraFalsa = Window & {
  __testStreams: MediaStream[];
  __cameraCalls: number;
  __canvasCamera: HTMLCanvasElement[];
  __intervalosCamera: number[];
};

/**
 * Versao de `instalarCameraFalsa` que devolve streams de canvas capturado a
 * 10 FPS, mantendo o canvas vivo e registrando cada chamada/stream na janela.
 */
async function instalarCameraFalsaComStreams(page: Page): Promise<void> {
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

type CorpoOperacional = {
  nivel?: string;
  origem?: string;
  mensagem?: string;
  detalhe?: string;
};

type Sessao = {
  sessaoId: string;
  ambiente: string;
  estado: string;
};

type Segmento = {
  segmentoId: string;
  sessaoId: string;
  sequencia: number;
  quadros: number;
  estado: string;
  motivoFim?: string;
  lacunas: Array<{ motivo: string; duracaoMs: number }>;
};

function corpoComoObjeto(valor: unknown): CorpoOperacional | null {
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

function textoOperacional(registro: CorpoOperacional): string {
  return [registro.mensagem, registro.detalhe, registro.origem]
    .filter((parte): parte is string => typeof parte === "string")
    .join(" ");
}

test("a troca real de MediaStream preserva a gravação e registra a rotura como pausa", async ({ page }) => {
  test.setTimeout(90_000);

  const quadrosReportados: unknown[] = [];
  const operacionais: CorpoOperacional[] = [];
  page.on("request", (req) => {
    if (req.method() !== "POST") return;
    let caminho = "";
    try {
      caminho = new URL(req.url()).pathname;
    } catch {
      return;
    }
    if (caminho !== "/api/monitoramento/quadros" && caminho !== "/api/operacional") return;
    let bruto: unknown;
    try {
      bruto = req.postDataJSON();
    } catch {
      return;
    }
    if (caminho === "/api/monitoramento/quadros") {
      quadrosReportados.push(bruto);
      return;
    }
    const corpo = corpoComoObjeto(bruto);
    if (corpo) operacionais.push(corpo);
  });

  await prepararPagina(page);
  await instalarCameraFalsaComStreams(page);

  try {
    await page.goto("/");
    await page.locator("#motor").selectOption("deteccao");
    await page.locator("#start").click();
    await expect(page.locator("#stop")).toBeEnabled();

    // Captura o id da sessao criada no servidor real para consultar o indice.
    const respostaSessao = page.waitForResponse(
      (resp) =>
        resp.request().method() === "POST" &&
        new URL(resp.url()).pathname === "/api/monitoramento/sessoes" &&
        resp.ok()
    );
    await expect(page.locator("#monitorIniciar")).toBeEnabled();
    await page.locator("#monitorIniciar").click();

    const criada = (await (await respostaSessao).json()) as { sessao?: Sessao };
    const sessaoIdCriada = criada.sessao?.sessaoId;
    expect(sessaoIdCriada).toBeTruthy();

    await expect(page.locator("#gravacaoIndicador")).toBeVisible();
    // Aguarda o primeiro quadro ser atribuido a um segmento antes de parar a trilha.
    await expect(page.locator("#gravacaoTexto")).toContainText(/segmento\s+\S+/, {
      timeout: 15_000,
    });
    const textoInicial = (await page.locator("#gravacaoTexto").textContent()) ?? "";
    const idSegmentoInicial = textoInicial.match(/segmento\s+(\S+)/)?.[1];
    expect(idSegmentoInicial).toBeTruthy();

    await expect
      .poll(() => quadrosReportados.length, { timeout: 15_000 })
      .toBeGreaterThanOrEqual(1);

    // Queda REAL: interrompe a trilha de video da primeira stream devolvida pela
    // camera. O Chromium NAO emite `ended` quando `stop()` e chamado (o evento
    // so nasce de uma desconexao fisica/falha da fonte), entao disparamos o
    // mesmo evento depois de parar a trilha para exercitar `Camera.tratarQueda`.
    // A reconexao e real: um novo `getUserMedia` devolve uma nova MediaStream.
    await page.evaluate(() => {
      const trilha = (window as unknown as JanelaCameraFalsa).__testStreams[0].getVideoTracks()[0];
      trilha.stop();
      trilha.dispatchEvent(new Event("ended"));
    });

    await expect(page.locator("#gravacaoTexto")).toContainText("sem sinal", {
      timeout: 10_000,
    });

    // A camera agenda a reconexao em 500 ms e pede um novo MediaStream.
    await page.waitForFunction(
      () => (window as unknown as JanelaCameraFalsa).__cameraCalls >= 2,
      undefined,
      { timeout: 10_000 }
    );
    await expect(page.locator("#gravacaoTexto")).not.toContainText("sem sinal", {
      timeout: 15_000,
    });
    // Apos `renovarGravador` + `retomarCaptura`, um novo segmento e atribuido.
    await expect(page.locator("#gravacaoTexto")).toContainText(/segmento\s+\S+/, {
      timeout: 15_000,
    });
    const textoFinal = (await page.locator("#gravacaoTexto").textContent()) ?? "";
    const idSegmentoFinal = textoFinal.match(/segmento\s+(\S+)/)?.[1];
    expect(idSegmentoFinal).toBeTruthy();
    expect(idSegmentoFinal, "a lacuna deve forcar a rotacao do segmento").not.toBe(
      idSegmentoInicial
    );

    // Na queda com monitoramento ativo, `suspenderCaptura` dispara `aoErro` do
    // controlador: origem "monitoramento", detalhe "Camera sem sinal: ...".
    // O ramo `origem: "camera"` so e usado quando a gravacao NAO esta ativa.
    await expect
      .poll(
        () => operacionais.some((registro) => /sem sinal/i.test(textoOperacional(registro))),
        { timeout: 15_000 }
      )
      .toBe(true);
    const queda = operacionais.find((registro) => /sem sinal/i.test(textoOperacional(registro)));
    expect(queda?.origem).toBe("monitoramento");
    expect(queda?.detalhe).toContain("Camera sem sinal");

    await expect
      .poll(
        () =>
          operacionais.some(
            (registro) =>
              registro.origem === "camera" && registro.mensagem === "Camera recuperada"
          ),
        { timeout: 15_000 }
      )
      .toBe(true);

    await page.locator("#monitorEncerrar").click();
    await expect(page.locator("#monitorIniciar")).toBeEnabled();

    // Contrato HTTP: sessao e segmentos persistidos pelo servidor real.
    const respostaSessoes = await page.request.get("/api/monitoramento/sessoes?limit=10");
    expect(respostaSessoes.ok()).toBe(true);
    const dadosSessoes = (await respostaSessoes.json()) as { sessoes: Sessao[] };
    const sessao =
      dadosSessoes.sessoes.find((item) => item.sessaoId === sessaoIdCriada) ??
      dadosSessoes.sessoes[0];
    expect(sessao?.sessaoId).toBe(sessaoIdCriada);
    expect(sessao?.ambiente).toBe("sala");

    const respostaSegmentos = await page.request.get(
      `/api/monitoramento/sessoes/${encodeURIComponent(sessao.sessaoId)}/segmentos?limit=1000`
    );
    expect(respostaSegmentos.ok()).toBe(true);
    const dadosSegmentos = (await respostaSegmentos.json()) as { segmentos: Segmento[] };
    const segmentos = dadosSegmentos.segmentos;
    expect(segmentos.length).toBeGreaterThanOrEqual(2);

    // `renovarGravador` pausa/retoma a sessao antes de trocar o MediaRecorder:
    // o segmento anterior e fechado com motivo "pausa" (a rotacao da lacuna),
    // e o proximo volta a receber quadros. O servidor so grava `motivoFim:
    // "lacuna"` quando detecta ausencia de quadros sem essa pausa explicita.
    const fechados = segmentos.filter((segmento) => segmento.motivoFim !== undefined);
    const rotacao =
      fechados.find((segmento) => segmento.motivoFim === "lacuna" && segmento.lacunas.length >= 1) ??
      fechados.find((segmento) => segmento.motivoFim === "pausa");
    expect(rotacao, "segmento fechado pela rotacao da lacuna").toBeTruthy();
    if (rotacao?.motivoFim === "lacuna") {
      expect(rotacao.lacunas.length).toBeGreaterThanOrEqual(1);
    }
    const indiceRotacao = segmentos.findIndex((s) => s.segmentoId === rotacao!.segmentoId);
    const posterior = segmentos.slice(indiceRotacao + 1).find((s) => s.quadros > 0);
    expect(posterior, "segmento posterior a rotacao com quadros > 0").toBeTruthy();
  } finally {
    // Limpeza best-effort: nao deve mascarar a assercao que falhou no corpo.
    const encerrar = page.locator("#monitorEncerrar");
    if (await encerrar.isEnabled()) await encerrar.click();
    const stop = page.locator("#stop");
    if (await stop.isEnabled()) await stop.click();
  }
});
