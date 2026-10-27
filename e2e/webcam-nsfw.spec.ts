import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { env } from "../src/env";

/**
 * E2E focado da fase NSFW (opt-in, mesmo clipe de `webcam.spec.ts`).
 *
 * Verifica o caminho real do modo de frame unico (`visao`): o classificador
 * YOLO NSFW roda no frame, as marcacoes entram no `POST /api/visao` e no evento
 * `done` (gravado pelo servidor antes de responder), sem bloquear a analise.
 * O clipe de bench nao precisa conter NSFW: o campo existe sempre que o
 * subsistema roda, mesmo com lista de marcacoes vazia. O bloco NSFW do prompt
 * padrao e coberto por `tests/server.test.ts` e `tests/visao.test.ts` (o cliente
 * nao monta esse prompt: quem anexa o bloco e o servidor).
 *
 *   $env:E2E_WEBCAM_CLIP = "bench/videos/webcam-atual.webm"
 *   npx playwright test e2e/webcam-nsfw.spec.ts --workers=1
 */

const CLIP = env.E2E_WEBCAM_CLIP || undefined;
const CANAL = env.E2E_WEBCAM_CHANNEL || undefined;

test.use(CANAL ? { channel: CANAL } : {});

test.describe("NSFW experimental com clipe real", () => {
  test("envia marcacoes e bloco NSFW ao backend e persiste a entrada", async ({ page }) => {
    test.skip(!CLIP, "defina E2E_WEBCAM_CLIP com o caminho de um clipe de bench/videos");
    if (!CLIP) return;
    test.setTimeout(600_000);

    const bytes = await readFile(CLIP);
    const dataUrl = `data:video/webm;base64,${bytes.toString("base64")}`;

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

    const corposVisao: Array<Record<string, unknown>> = [];
    const eventosDone: Array<Record<string, unknown>> = [];
    page.on("request", (req) => {
      if (req.method() !== "POST" || !req.url().endsWith("/api/visao")) return;
      try {
        corposVisao.push(JSON.parse(req.postData() || "{}"));
      } catch {
        // ignora payloads nao-JSON
      }
    });
    page.on("response", (res) => {
      if (res.request().method() !== "POST" || !res.url().endsWith("/api/visao")) return;
      void res
        .text()
        .then((texto) => {
          for (const linha of texto.split("\n")) {
            if (!linha.trim()) continue;
            try {
              const evt = JSON.parse(linha) as Record<string, unknown>;
              if (evt.type === "done") eventosDone.push(evt);
            } catch {
              // ignora linhas parciais
            }
          }
        })
        .catch(() => undefined);
    });

    await page.goto("/");
    await page.locator("#motor").selectOption("visao");
    await page.locator("#nsfw").check();
    await page.locator("#interval").evaluate((el) => {
      const input = el as HTMLInputElement;
      input.value = "1";
      input.dispatchEvent(new Event("input"));
    });

    await page.locator("#start").click();
    await expect
      .poll(() => corposVisao.length, { timeout: 300_000 })
      .toBeGreaterThan(0);

    // O corpo do /api/visao e montado antes da chamada ao backend; o campo NSFW
    // precisa estar presente mesmo sem esperar a resposta.
    expect(corposVisao[0]).toHaveProperty("nsfw");
    expect(Array.isArray(corposVisao[0].nsfw)).toBe(true);

    // O servidor grava a entrada antes de emitir `done`; o evento carrega as
    // mesmas marcacoes persistidas (inclusive lista vazia).
    await expect.poll(() => eventosDone.length, { timeout: 300_000 }).toBeGreaterThan(0);
    expect(eventosDone[0]).toHaveProperty("nsfw");
    expect(Array.isArray(eventosDone[0].nsfw)).toBe(true);

    await page.locator("#stop").click();
    await expect(page.locator("#start")).toBeEnabled();
  });
});
