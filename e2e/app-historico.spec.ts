import { expect, test } from "@playwright/test";
import { prepararPagina, instalarCameraFalsa } from "./helpers/app-fixtures";

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

  await page.locator("#filter").fill("yolov10");
  await expect(page.locator("#log li", { hasText: "yolov10n" })).toBeVisible();
  await expect(page.locator("#log li", { hasText: "qwen2.5-vl" })).toBeHidden();
});

test("limpar o historico zera a lista e apaga no servidor", async ({ page }) => {
  const chamadas: string[] = [];
  await prepararPagina(page);
  await page.route("**/api/logs", (rota) => {
    if (rota.request().method() === "DELETE") {
      chamadas.push("DELETE");
      return rota.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, snapshots: 0 }),
      });
    }
    return rota.continue();
  });

  await page.goto("/");
  await expect(page.locator("#log li")).toHaveCount(2);
  await expect(page.locator("#clearLog")).toBeEnabled();

  await page.locator("#clearLog").click();

  await expect(page.locator("#status")).toContainText("Historico limpo");
  await expect(page.locator("#log li")).toHaveCount(0);
  await expect(page.locator("#logCount")).toHaveText("0");
  await expect(page.locator("#clearLog")).toBeDisabled();
  expect(chamadas).toEqual(["DELETE"]);
});

test("o snapshot do historico e o frame analisado, com o instante da captura", async ({ page }) => {
  await prepararPagina(page);
  await instalarCameraFalsa(page);
  await page.goto("/");
  await page.locator("#motor").selectOption("deteccao");

  const pedido = page.waitForRequest(
    (req) => req.method() === "POST" && new URL(req.url()).pathname === "/api/log"
  );
  await page.locator("#start").click();

  const requisicao = await pedido;
  const corpo = requisicao.postDataJSON() as {
    capturadoEm?: string;
    timestamp: string;
    snapshot?: string;
  };
  expect(corpo.capturadoEm).toBeTruthy();
  expect(corpo.snapshot).toMatch(/^data:image\/jpeg/);
  expect(Date.parse(corpo.capturadoEm!)).toBeLessThanOrEqual(Date.parse(corpo.timestamp));

  // A entrada na tela usa o horario da captura do frame como horario principal.
  await expect(page.locator("#log li").first().locator(".time")).toHaveAttribute(
    "title",
    /Frame capturado às/
  );
  await page.locator("#stop").click();
  await expect(page.locator("#start")).toBeEnabled();
});
