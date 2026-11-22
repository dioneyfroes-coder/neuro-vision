import { expect, test } from "@playwright/test";
import { prepararPagina } from "./helpers/app-fixtures";

test("exibe o painel de inventário com ações desabilitadas fora da gravação", async ({ page }) => {
  await prepararPagina(page);
  await page.goto("/");

  const painel = page.locator("#inventarioPainel");
  await expect(painel).toBeVisible();
  await expect(painel.locator("summary")).toContainText("sem inventário");
  await expect(page.locator("#inventarioColetar")).toBeDisabled();
  await expect(page.locator("#inventarioAtualizar")).toBeDisabled();
  await expect(page.locator("#inventarioItens")).toContainText("Nenhum objeto detectado");
  await expect(page.locator("#inventarioMudancas")).toContainText("Nenhuma mudança registrada");
});

test("mostra o estado passivo e aceita zonas normalizadas fora da gravação", async ({ page }) => {
  await prepararPagina(page);
  await page.goto("/");

  const painel = page.locator("#atencaoPainel");
  await expect(painel).toBeVisible();
  await expect(page.locator("#atencaoEstado")).toHaveText("passivo");
  await expect(page.locator("#atencaoCadencia")).toContainText("10s por quadro");
  await painel.locator("summary").click();
  await page.locator("#atencaoZonaEntrada").fill("0,0,0.5,1");
  await page.locator("#atencaoZonaAplicar").click();
  await expect(page.locator("#atencaoZonaEntrada")).toHaveValue("0,0,0.5,1");
  await expect(page.locator("#atencaoCusto")).toContainText("sem amostras");
});
