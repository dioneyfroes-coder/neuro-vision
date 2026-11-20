import { expect, type Page } from "@playwright/test";
import { LIMIAR, MODO, MODELO_VISAO, NSFW_ATIVO, VARIANTE_BASELINE } from "./ambiente";

export async function configurarInterface(page: Page): Promise<void> {
    await page.goto("/");
    await page.locator("#motor").selectOption(MODO);
    if (MODELO_VISAO) {
      await expect(page.locator("#modeloVisao option").filter({ hasText: MODELO_VISAO })).toHaveCount(
        1,
        { timeout: 30_000 }
      );
      await page.locator("#modeloVisao").selectOption(MODELO_VISAO);
    }
    if (NSFW_ATIVO) await page.locator("#nsfw").check();
    if (!Number.isFinite(LIMIAR) || LIMIAR < 0.1 || LIMIAR > 0.9) {
      throw new Error("E2E_WEBCAM_THRESHOLD precisa estar entre 0.1 e 0.9");
    }
    await page.locator("#threshold").evaluate((el, valor) => {
      const input = el as HTMLInputElement;
      input.value = String(valor);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, LIMIAR);
    await page.locator("#interval").evaluate((el) => {
      const input = el as HTMLInputElement;
      input.value = "1";
      input.dispatchEvent(new Event("input"));
    });
}

export async function prepararEAquecer(page: Page): Promise<void> {
    // 1) Carrega o modelo diretamente no backend, sem alterar o estado
    //    temporal da sessão que será medida.
    if (VARIANTE_BASELINE) {
      const preparacao = await page.evaluate(async (modelo) => {
        const url = modelo
          ? `/api/visao/preparar?modelo=${encodeURIComponent(modelo)}`
          : "/api/visao/preparar";
        const resposta = await fetch(url);
        const dados = (await resposta.json()) as {
          ok?: boolean;
          carregado?: boolean;
          modelo?: string;
          erro?: string;
        };
        return { httpOk: resposta.ok, ...dados };
      }, MODELO_VISAO);
      expect(preparacao, "nao foi possivel carregar o modelo multimodal antes da coleta").toMatchObject({
        httpOk: true,
        ok: true,
        carregado: true,
        ...(MODELO_VISAO ? { modelo: MODELO_VISAO } : {}),
      });
    }

    // Aquece tambem o detector local. A sessao e reiniciada em seguida para
    // zerar a politica de cooldown antes do primeiro frame medido.
    await page.locator("#start").click();
    await expect(page.locator("#status")).toContainText("Viu:", { timeout: 300_000 });
    await page.locator("#stop").click();
    await expect(page.locator("#start")).toBeEnabled();
}
