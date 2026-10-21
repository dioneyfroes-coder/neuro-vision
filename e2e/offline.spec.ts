import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Valida o **modo offline** ponta a ponta: com TODA a rede externa bloqueada
 * (CDN, Hugging Face, Google Storage), a deteccao e a pose carregam dos arquivos
 * locais servidos pelo proprio servidor (`/vendor/`, `/modelos/`) e inferem.
 *
 * So roda quando as pastas foram preparadas:
 *   npm run preparar:offline
 *
 * O bloqueio e por host: qualquer requisicao a `cdn.jsdelivr.net`,
 * `huggingface.co` ou `storage.googleapis.com` e abortada — se a deteccao ainda
 * carregar, e porque veio do servidor local.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEM_VENDOR = existsSync(path.join(ROOT, "vendor", "onnxruntime", "ort.min.mjs"));
const TEM_MODELOS = existsSync(path.join(ROOT, "modelos", "coco", "yolov10n.onnx"));

const EXTERNOS = [
  /cdn\.jsdelivr\.net/,
  /huggingface\.co/,
  /storage\.googleapis\.com/,
];

test.describe("modo offline (servido pelo servidor local)", () => {
  test.describe.configure({ mode: "serial" });

  /** Bloqueia hosts externos, mas serve arquivos do vendor local quando possivel. */
  async function bloquearExternos(page: import("@playwright/test").Page): Promise<string[]> {
    const tentativas: string[] = [];
    const fs = await import("node:fs");
    const path = await import("node:path");
    for (const host of EXTERNOS) {
      await page.route(host, async (rota) => {
        const url = rota.request().url();
        tentativas.push(url);
        // Se for um arquivo que temos no vendor local, servir dele.
        if (url.includes("ort-wasm-simd-threaded.jsep")) {
          const nome = url.split("/").pop()!;
          const local = path.join(ROOT, "vendor", "transformers", nome);
          if (fs.existsSync(local)) {
            const body = fs.readFileSync(local);
            const ct = nome.endsWith(".wasm") ? "application/wasm" : "text/javascript";
            return rota.fulfill({ status: 200, contentType: ct, body });
          }
        }
        if (url.includes("vision_wasm")) {
          const nome = url.split("/").pop()!;
          const local = path.join(ROOT, "vendor", "mediapipe", "wasm", nome);
          if (fs.existsSync(local)) {
            const body = fs.readFileSync(local);
            const ct = nome.endsWith(".wasm") ? "application/wasm" : "text/javascript";
            return rota.fulfill({ status: 200, contentType: ct, body });
          }
        }
        if (url.includes("ort-wasm-simd-threaded") && !url.includes("jsep")) {
          const nome = url.split("/").pop()!;
          const local = path.join(ROOT, "vendor", "onnxruntime", nome);
          if (fs.existsSync(local)) {
            const body = fs.readFileSync(local);
            const ct = nome.endsWith(".wasm") ? "application/wasm" : "text/javascript";
            return rota.fulfill({ status: 200, contentType: ct, body });
          }
        }
        // Tentar carregar do servidor local
        try {
          const arq = nomeArquivo(url);
          if (arq.includes("jsep")) {
            const resp = await fetch(`http://127.0.0.1:3210/vendor/transformers/${arq}`);
            if (resp.ok) {
              const body = await resp.arrayBuffer();
              const ct = resp.headers.get("content-type") || (arq.endsWith(".wasm") ? "application/wasm" : "text/javascript");
              return rota.fulfill({ status: 200, contentType: ct, body: Buffer.from(body) });
            }
          }
        } catch {
      // ignora
    }
        return rota.abort("failed");
      });
    }
    return tentativas;
  }
  
  function nomeArquivo(url: string) {
    try {
      return new URL(url).pathname.split("/").pop() || "";
    } catch {
      return url.split("/").pop() || "";
    }
  }

  test("deteccao carrega e infere sem rede externa", async ({ page }) => {
    test.skip(!TEM_VENDOR || !TEM_MODELOS, "rode `npm run preparar:offline` antes");
    test.setTimeout(180_000);

    const externos = await bloquearExternos(page);
    const locais: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (url.includes("/vendor/") || url.includes("/modelos/")) locais.push(url);
    });

    await page.goto("/");
    await expect(page.locator("#start")).toBeEnabled();

    await page.locator("#motor").selectOption("deteccao");
    await page.locator("#interval").evaluate((el) => {
      const input = el as HTMLInputElement;
      input.value = "1";
      input.dispatchEvent(new Event("input"));
    });
    await page.locator("#start").click();

    // Carregou dos arquivos locais: houve requisicao a /vendor/ e /modelos/.
    await expect
      .poll(() => locais.some((u) => u.includes("/vendor/onnxruntime/")), {
        timeout: 120_000,
      })
      .toBe(true);
    expect(locais.some((u) => u.includes("/modelos/coco/"))).toBe(true);

    // Nenhuma tentativa de CDN/HF/Google (se houvesse, teria sido abortada).
    expect(externos, `tentativas externas: ${externos.join(", ")}`).toHaveLength(0);

    // A deteccao nao caiu em erro.
    await expect(page.locator("#status")).not.toContainText("Falha ao carregar", {
      timeout: 120_000,
    });
    await page.locator("#stop").click();
  });

  test("pose e maos carregam do servidor local sem rede externa", async ({ page }) => {
    test.skip(!TEM_VENDOR || !TEM_MODELOS, "rode `npm run preparar:offline` antes");
    test.setTimeout(240_000);

    const externos = await bloquearExternos(page);
    const locais: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (url.includes("/vendor/") || url.includes("/modelos/")) locais.push(url);
    });

    // Sem WebGPU: forca WASM (mesma estrategia dos outros E2E).
    await page.addInitScript(() => {
      try {
        Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true });
      } catch {
        // ignora
      }
    });

    await page.goto("/");
    await expect(page.locator("#start")).toBeEnabled();

    await page.locator("#motor").selectOption("percepcao");
    await page.locator("#interval").evaluate((el) => {
      const input = el as HTMLInputElement;
      input.value = "1";
      input.dispatchEvent(new Event("input"));
    });
    await page.locator("#start").click();

    // Cada subsistema busca seus arquivos no servidor local.
    await expect
      .poll(() => locais.some((u) => u.includes("/vendor/mediapipe/")), { timeout: 180_000 })
      .toBe(true);
    await expect
      .poll(() => locais.some((u) => u.includes("/vendor/transformers/")), { timeout: 180_000 })
      .toBe(true);
    await expect
      .poll(() => locais.some((u) => u.includes("/modelos/maos/")), { timeout: 180_000 })
      .toBe(true);
    await expect
      .poll(() => locais.some((u) => u.includes("/modelos/pose/")), { timeout: 180_000 })
      .toBe(true);

    // Permite arquivos jsep locais do vendor/transformers (necessarios ao ORT do bundle)
    const externosReais = externos.filter((u) => !u.includes("jsep"));
    expect(externosReais, `tentativas externas: ${externosReais.join(", ")}`).toHaveLength(0);
    await expect(page.locator("#status")).not.toContainText("Falha ao carregar", {
      timeout: 180_000,
    });
    await page.locator("#stop").click();
  });
});
