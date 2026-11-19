import { expect, test } from "@playwright/test";
import { prepararPagina, instalarCameraFalsa, FALHA_ORT, CDN_ORT } from "./helpers/app-fixtures";

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
  await prepararPagina(page, { ort: FALHA_ORT });
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

test("libera a webcam quando a preparacao da visao falha", async ({ page }) => {
  await prepararPagina(page);
  await page.route("**/api/visao/preparar", (rota) =>
    rota.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, erro: "modelo indisponivel" }),
    })
  );
  await instalarCameraFalsa(page);
  await page.goto("/");
  await page.locator("#motor").selectOption("visao");
  await page.locator("#start").click();

  await expect(page.locator("#status")).toContainText("Falha ao preparar o modelo de visao");
  await expect(page.locator("#start")).toBeEnabled();
  await expect(page.locator("#stop")).toBeDisabled();
  await expect(page.locator("#placeholder")).toBeVisible();

  const estado = await page.evaluate(
    () => (window as unknown as { __testStream: MediaStream }).__testStream.getTracks()[0].readyState
  );
  expect(estado).toBe("ended");
});

test("rede offline nao quebra a pagina e a deteccao falha com mensagem clara", async ({
  page,
}) => {
  await prepararPagina(page);
  // CDN de inferencia (onnxruntime-web) inacessivel: a dependencia e carregada
  // sob demanda, entao a pagina abre normalmente e so a deteccao falha.
  await page.route(CDN_ORT, (rota) => rota.abort("failed"));
  await instalarCameraFalsa(page);
  await page.goto("/");

  // A pagina carrega normalmente (historico + controles + status da visao).
  await expect(page.locator("#start")).toBeEnabled();
  await expect(page.locator("#log li")).toHaveCount(2);

  // A deteccao falha com mensagem clara, libera a webcam e devolve a UI.
  await page.locator("#motor").selectOption("deteccao");
  await page.locator("#start").click();
  await expect(page.locator("#status")).toContainText("Falha ao carregar modelo");
  await expect(page.locator("#start")).toBeEnabled();
  await expect(page.locator("#stop")).toBeDisabled();

  const estado = await page.evaluate(
    () => (window as unknown as { __testStream: MediaStream }).__testStream.getTracks()[0].readyState
  );
  expect(estado).toBe("ended");
});
