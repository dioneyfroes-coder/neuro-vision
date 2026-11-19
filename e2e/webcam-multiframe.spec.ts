import { test } from "@playwright/test";
import { CANAL, CLIP, MODOS, executarModoMultiframe } from "./helpers/webcam-multiframe";

/**
 * Smoke E2E dos modos multiframe (Etapa 9).
 *
 * Igual ao `webcam.spec.ts`, usa o pipeline REAL: o clipe (.webm/.mp4 de
 * bench/videos/) roda no lugar da webcam (video oculto -> canvas ->
 * captureStream) e a aplicacao faz sozinha o trabalho — captura 4 frames a
 * 1 frame/s, percepcao local (quando a variante usa), motor temporal,
 * interpretacao pelo modelo de visao local (LM Studio) e persistencia.
 *
 * Para cada modo (B `percepcao-sequencia`, C `percepcao-fundida`,
 * D `percepcao`) captura e salva: a interface so expoe `percepcao`; as
 * variantes B/C sao de benchmark e a opcao e injetada pelo proprio teste.
 *   - eventos  (POST /api/eventos)  -> logs/e2e-multiframe-<modo>.jsonl
 *   - entradas (POST /api/log, com o campo `modelo` da IA local)
 *                                 -> logs/e2e-multiframe-<modo>.log.jsonl
 *   - ciclos   (POST /api/ciclos, RegistroCiclo com metricas por etapa)
 *                                 -> logs/e2e-multiframe-<modo>.ciclos.jsonl
 *
 * Os arquivos de ciclos servem de entrada direta ao harness de benchmark:
 *   node scripts/benchmark-variantes.mjs --ciclos-B logs/e2e-multiframe-percepcao-sequencia.ciclos.jsonl [...]
 *
 * Opt-in (precisa de clipe e do LM Studio online para a interpretacao real):
 *   $env:E2E_WEBCAM_CLIP = "bench/videos/webcam-mudanca.webm"
 *   $env:E2E_WEBCAM_CHANNEL = "chrome"        # opcional: Chrome instalado (WebGPU)
 *   $env:E2E_WEBCAM_EVENTOS = "logs/e2e-multiframe.jsonl"  # prefixo dos arquivos
 *   npx playwright test e2e/webcam-multiframe.spec.ts --workers=1
 * O teste abre `/?benchmark=eval`: política de 1 s e interpretação em todo ciclo.
 */

// Com canal instalado (ex.: "chrome") o WebGPU fica disponivel; sem ele,
// usamos o Chromium do Playwright (WASM/CPU) — mais lento, mas funcional.
test.use(CANAL ? { channel: CANAL } : {});

test.describe.configure({ mode: "serial" });

for (const { id, letra } of MODOS) {
  test(`modo ${id} (variante ${letra}): 4 frames -> percepcao -> IA local -> ciclos`, async ({ page }) => {
    test.skip(!CLIP, "defina E2E_WEBCAM_CLIP com o caminho de um clipe de bench/videos");
    if (!CLIP) return;
    test.setTimeout(900_000);
    await executarModoMultiframe(page, id, letra);
  });
}
