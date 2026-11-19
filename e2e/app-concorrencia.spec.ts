import { expect, test } from "@playwright/test";
import { prepararPagina, instalarCameraFalsa, ORT_LENTO } from "./helpers/app-fixtures";

test("bloqueia trocar motor/modelo durante a execucao e libera ao parar", async ({ page }) => {
  await prepararPagina(page, { ort: ORT_LENTO });
  await instalarCameraFalsa(page);
  await page.goto("/");
  await page.locator("#motor").selectOption("deteccao");
  await expect(page.locator("#motor")).toBeEnabled();
  await expect(page.locator("#model")).toBeEnabled();
  await expect(page.locator("#modeloVisao")).toBeEnabled();

  await page.locator("#start").click();
  await page.waitForFunction(
    () => ((window as unknown as { __deteccoes?: number }).__deteccoes ?? 0) >= 1,
    undefined,
    { timeout: 15_000 }
  );
  await expect(page.locator("#motor")).toBeDisabled();
  await expect(page.locator("#model")).toBeDisabled();
  await expect(page.locator("#modeloVisao")).toBeDisabled();

  await page.locator("#stop").click();
  await expect(page.locator("#motor")).toBeEnabled();
  await expect(page.locator("#model")).toBeEnabled();
  await expect(page.locator("#modeloVisao")).toBeEnabled();
});

test("parar durante a inferencia libera a webcam e permite iniciar de novo", async ({ page }) => {
  await prepararPagina(page, { ort: ORT_LENTO });
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

test("inferencia lenta nao sobrepoe analises mesmo com intervalo curto", async ({ page }) => {
  await prepararPagina(page, { ort: ORT_LENTO });
  await instalarCameraFalsa(page);
  await page.goto("/");
  await page.locator("#motor").selectOption("deteccao");
  await page.locator("#interval").evaluate((el) => {
    const input = el as HTMLInputElement;
    input.value = "1";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.locator("#start").click();

  await page.waitForFunction(
    () => ((window as unknown as { __deteccoes?: number }).__deteccoes ?? 0) >= 3,
    undefined,
    { timeout: 25_000 }
  );

  const resultado = await page.evaluate(() => {
    const w = window as unknown as { __sobreposicoes?: number; __inicios?: number[] };
    return { sobreposicoes: w.__sobreposicoes ?? 0, inicios: w.__inicios ?? [] };
  });

  expect(resultado.sobreposicoes).toBe(0);
  for (let i = 1; i < resultado.inicios.length; i++) {
    // Cada ciclo so comeca apos a inferencia anterior (2,5s) terminar.
    expect(resultado.inicios[i] - resultado.inicios[i - 1]).toBeGreaterThanOrEqual(2500);
  }

  await page.locator("#stop").click();
  await expect(page.locator("#start")).toBeEnabled();
});
