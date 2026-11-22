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
