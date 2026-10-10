import { expect, test, type Page } from "@playwright/test";

const CDN_TRANSFORMERS = /cdn\.jsdelivr\.net\/npm\/@huggingface\/transformers/;

const STUB_TRANSFORMERS = `
export const env = {};
export async function pipeline() {
  return async () => [];
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

async function prepararPagina(page: Page): Promise<void> {
  await page.route(CDN_TRANSFORMERS, (rota) =>
    rota.fulfill({ status: 200, contentType: "text/javascript", body: STUB_TRANSFORMERS })
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
