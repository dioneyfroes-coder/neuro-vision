import { expect, test, type Page } from "@playwright/test";

const CDN_TRANSFORMERS = /cdn\.jsdelivr\.net\/npm\/@huggingface\/transformers/;

const STUB_TRANSFORMERS = `
export const env = {};
export async function pipeline() {
  return async () => [];
}
`;

const FALHA_TRANSFORMERS = `
export const env = {};
export async function pipeline() {
  throw new Error("modelo indisponivel");
}
`;

const DETECTOR_LENTO = `
export const env = {};
export async function pipeline() {
  return async () => {
    window.__deteccoes = (window.__deteccoes || 0) + 1;
    await new Promise((resolve) => setTimeout(resolve, 2500));
    return [];
  };
}
`;

const ENTRADAS = [
  {
    timestamp: "2026-10-10T12:00:05.000Z",
    modelo: "qwen3-vl:4b",
    objetos: [],
    resumo: "Uma pessoa no escritorio.",
    tipo: "descricao",
  },
  {
    timestamp: "2026-10-10T12:00:00.000Z",
    modelo: "Xenova/yolos-tiny",
    objetos: [
      { nome: "pessoa", rotulo: "person", score: 0.9, caixa: { xmin: 0, ymin: 0, xmax: 1, ymax: 1 } },
    ],
    resumo: "pessoa",
    tipo: "deteccao",
  },
];

async function prepararPagina(page: Page, transformersBody = STUB_TRANSFORMERS): Promise<void> {
  await page.route(CDN_TRANSFORMERS, (rota) =>
    rota.fulfill({ status: 200, contentType: "text/javascript", body: transformersBody })
  );
  await page.route("**/api/health", (rota) =>
    rota.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        ollama: { online: false, modelos: [], erro: "desligado" },
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

async function instalarCameraFalsa(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      (window as unknown as { __testStream: MediaStream }).__testStream = stream;
      return stream;
    };
  });
}

test("carrega o historico persistido", async ({ page }) => {
  await prepararPagina(page);
  await page.goto("/");

  await expect(page.locator("#log li")).toHaveCount(2);
  await expect(page.locator("#logCount")).toHaveText("2");
  await expect(page.locator("#log")).toContainText("Uma pessoa no escritorio.");
  await expect(page.locator("#log")).toContainText("pessoa 90%");
});

test("filtra as entradas do historico", async ({ page }) => {
  await prepararPagina(page);
  await page.goto("/");
  await expect(page.locator("#log li")).toHaveCount(2);

  await page.locator("#filter").fill("yolos");
  await expect(page.locator("#log li", { hasText: "yolos-tiny" })).toBeVisible();
  await expect(page.locator("#log li", { hasText: "qwen3-vl" })).toBeHidden();
});

test("exibe o status do Ollama", async ({ page }) => {
  await prepararPagina(page);
  await page.goto("/");
  await expect(page.locator("#ollamaStatus")).toContainText("offline");
});

test("reabilita o Iniciar quando o acesso a webcam falha", async ({ page }) => {
  await prepararPagina(page);
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new Error("Permissao negada");
    };
  });
  await page.goto("/");
  await page.locator("#start").click();

  await expect(page.locator("#status")).toContainText("webcam");
  await expect(page.locator("#start")).toBeEnabled();
  await expect(page.locator("#stop")).toBeDisabled();
  await expect(page.locator("#placeholder")).toBeVisible();
});

test("libera a webcam quando o modelo de deteccao falha ao carregar", async ({ page }) => {
  await prepararPagina(page, FALHA_TRANSFORMERS);
  await instalarCameraFalsa(page);
  await page.goto("/");
  await page.locator("#motor").selectOption("deteccao");
  await page.locator("#start").click();

  await expect(page.locator("#status")).toContainText("Falha ao carregar modelo");
  await expect(page.locator("#start")).toBeEnabled();
  await expect(page.locator("#stop")).toBeDisabled();
  await expect(page.locator("#placeholder")).toBeVisible();

  const estado = await page.evaluate(
    () => (window as unknown as { __testStream: MediaStream }).__testStream.getTracks()[0].readyState
  );
  expect(estado).toBe("ended");
});

test("parar durante a inferencia libera a webcam e permite iniciar de novo", async ({ page }) => {
  await prepararPagina(page, DETECTOR_LENTO);
  await instalarCameraFalsa(page);
  await page.goto("/");
  await page.locator("#motor").selectOption("deteccao");
  await page.locator("#start").click();

  await page.waitForFunction(
    () => ((window as unknown as { __deteccoes?: number }).__deteccoes ?? 0) >= 1,
    undefined,
    { timeout: 15_000 }
  );
  await expect(page.locator("#stop")).toBeEnabled();
  await page.locator("#stop").click();

  await expect(page.locator("#start")).toBeEnabled();
  await expect(page.locator("#stop")).toBeDisabled();
  const parada = await page.evaluate(
    () => (window as unknown as { __testStream: MediaStream }).__testStream.getTracks()[0].readyState
  );
  expect(parada).toBe("ended");

  await page.locator("#start").click();
  await page.waitForFunction(
    () => ((window as unknown as { __deteccoes?: number }).__deteccoes ?? 0) >= 2,
    undefined,
    { timeout: 15_000 }
  );
  await expect(page.locator("#stop")).toBeEnabled();
  await page.locator("#stop").click();
  await expect(page.locator("#start")).toBeEnabled();
});
