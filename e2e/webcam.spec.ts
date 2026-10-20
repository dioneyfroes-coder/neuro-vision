import { expect, test } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../src/env";

/**
 * Avaliacao com clipe REAL de webcam (Fase 7).
 *
 * Diferente de `app.spec.ts`, este teste **nao** substitui o runtime: ele usa o
 * YOLOv10n real em ONNX (onnxruntime-web + pesos do Hugging Face) e reproduz
 * um clipe `.webm` gravado com `scripts/gravar-webcam.mjs` como se fosse a
 * webcam. Os eventos que o app grava (`POST /api/eventos`) sao capturados e
 * salvos em JSONL, para serem comparados com uma anotacao via `npm run qualidade`.
 *
 * Fica desligado por padrao (depende de rede, clipe gravado e modelo baixado).
 * A inferencia roda em WASM/CPU (~1-2 s por quadro no Chromium do Playwright),
 * sem depender de WebGPU — a mesma rota de producao. Passe o canal se quiser o
 * Chrome instalado:
 *
 *   $env:E2E_WEBCAM_CLIP = "bench/videos/webcam.webm"
 *   $env:E2E_WEBCAM_CHANNEL = "chrome"   # usa o Chrome instalado (WebGPU)
 *   $env:E2E_WEBCAM_EVENTOS = "logs/webcam-eventos.jsonl"
 *   npx playwright test e2e/webcam.spec.ts --workers=1
 */

const CLIP = env.E2E_WEBCAM_CLIP || undefined;
const CANAL = env.E2E_WEBCAM_CHANNEL || undefined;
const DEBUG = env.E2E_WEBCAM_DEBUG;

// Com um canal instalado (ex.: "chrome") o WebGPU fica disponivel; sem ele,
// usamos o Chromium do Playwright (WASM/CPU). Precisa ser de nivel superior.
test.use(CANAL ? { channel: CANAL } : {});

test.describe("avaliacao com clipe real de webcam", () => {
  test("reproduz o clipe e grava os eventos reais", async ({ page }) => {
    test.skip(!CLIP, "defina E2E_WEBCAM_CLIP com o caminho de um .webm gravado");
    if (!CLIP) return;
    test.setTimeout(600_000);

    const bytes = await readFile(CLIP);
    const dataUrl = `data:video/webm;base64,${bytes.toString("base64")}`;

    // Replay: um <video> oculto com o clipe fica parado no 1o quadro; um canvas
    // redesenha os quadros e vira a "camera" retornada por getUserMedia. Cada
    // chamada devolve um stream novo, porque o app para as trilhas ao encerrar.
    // Sem WebGPU (sem canal instalado) escondemos `navigator.gpu` para forcar o
    // WASM, porque um adaptador inexistente quebra as duas trilhas.
    await page.addInitScript(
      ({ src, semGpu }) => {
        if (semGpu) {
          try {
            Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true });
          } catch {
            // ignora
          }
        }

        const video = document.createElement("video");
        video.muted = true;
        video.playsInline = true;
        video.preload = "auto";
        video.src = src;

        const janela = window as unknown as {
          __clipVideo: HTMLVideoElement;
          __tocarClip: () => void;
        };
        janela.__clipVideo = video;

        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 480;
        const ctx = canvas.getContext("2d");
        const desenhar = () => {
          if (ctx && video.videoWidth) {
            if (canvas.width !== video.videoWidth) {
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
            }
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          }
          requestAnimationFrame(desenhar);
        };
        requestAnimationFrame(desenhar);

        const pronto = new Promise<void>((resolve) => {
          if (video.readyState >= 2) resolve();
          else video.addEventListener("loadeddata", () => resolve(), { once: true });
        });

        janela.__tocarClip = () => {
          video.currentTime = 0;
          void video.play();
        };

        navigator.mediaDevices.getUserMedia = async () => {
          await pronto;
          return canvas.captureStream(15);
        };
      },
      { src: dataUrl, semGpu: !CANAL }
    );

    const eventos: Array<{ tipo?: string; timestamp?: string; descricao?: string }> = [];
    const analises: Array<{ resumo?: string; timestamp?: string }> = [];
    if (DEBUG) {
      page.on("console", (m) => console.log(`[console:${m.type()}] ${m.text()}`));
      page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
    }
    page.on("request", (req) => {
      if (req.method() !== "POST") return;
      const url = req.url();
      const body = req.postData() || "{}";
      try {
        if (url.endsWith("/api/eventos")) eventos.push(JSON.parse(body));
        else if (url.endsWith("/api/log")) analises.push(JSON.parse(body));
      } catch {
        // ignora payloads nao-JSON
      }
    });

    await page.goto("/");
    await page.locator("#motor").selectOption("deteccao");
    await page.locator("#interval").evaluate((el) => {
      const input = el as HTMLInputElement;
      input.value = "1";
      input.dispatchEvent(new Event("input"));
    });

    // 1) Deixa o clipe parado no 1o quadro e aguarda o modelo real carregar e a
    //    primeira analise terminar. So entao o clipe comeca a tocar, para que a
    //    linha do tempo medida seja a do clipe (nao a do download do modelo).
    await page.locator("#start").click();
    await expect(page.locator("#status")).toContainText("Viu:", { timeout: 300_000 });

    // 2) Zera a captura e toca o clipe do inicio. `inicio` e a base da anotacao.
    eventos.length = 0;
    analises.length = 0;
    const inicio = new Date().toISOString();
    await page.evaluate(() => (window as unknown as { __tocarClip: () => void }).__tocarClip());

    const duracaoMs = await page.evaluate(() => {
      const d = (window as unknown as { __clipVideo?: HTMLVideoElement }).__clipVideo?.duration;
      return Number.isFinite(d) && d && d > 0 ? Math.ceil(d * 1000) : 30_000;
    });
    await page.waitForTimeout(duracaoMs + 3000);
    await page.locator("#stop").click();
    await expect(page.locator("#start")).toBeEnabled();

    expect(eventos.length, "nenhum evento foi capturado (a deteccao nao rodou?)").toBeGreaterThan(0);

    const destino = path.resolve(env.E2E_WEBCAM_EVENTOS || "logs/webcam-eventos.jsonl");
    await mkdir(path.dirname(destino), { recursive: true });
    await writeFile(destino, eventos.map((e) => JSON.stringify(e)).join("\n") + "\n");
    // Base para os offsets `em` da anotacao (instante em que o clipe tocou).
    await writeFile(`${destino}.inicio`, `${inicio}\n`);

    const base = Date.parse(inicio);
    const em = (ts?: string): number => (ts ? Math.round(Date.parse(ts) - base) : -1);
    console.log(`inicio (base da anotacao): ${inicio}`);
    console.log(`Analises: ${analises.length}`);
    for (const a of analises) console.log(`  +${em(a.timestamp)}ms  ${a.resumo ?? ""}`);
    console.log(`Eventos: ${eventos.length}`);
    for (const e of eventos) console.log(`  +${em(e.timestamp)}ms  ${e.tipo}  ${e.descricao ?? ""}`);
    console.log(`Salvos em ${destino}`);
    console.log(`Compare: npm run qualidade -- --anotacao <clipe>.json --eventos ${destino}`);
  });
});
