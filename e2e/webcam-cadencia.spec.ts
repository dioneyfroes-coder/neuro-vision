import { expect, test } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../src/env";

/**
 * Benchmark E2E da cadencia independente (Fase 1.3/1.4).
 *
 * Roda a aplicacao REAL sobre um clipe (`E2E_WEBCAM_CLIP`) com
 * `/?benchmark=5fps`: 5 snapshots a 200 ms, maos com alvo de 5 FPS e
 * pose/deteccao a 1 Hz. O objetivo NAO e provar que o hardware atinge 5 FPS de
 * inferencia — e provar que o **plano de amostragem** e aplicado e registrado:
 *
 *   - o ciclo tem 5 frames e politica `benchmark-5fps`;
 *   - `metricas.amostragem` existe por subsistema;
 *   - maos sao amostradas em todos os 5 frames (alvo 200 ms) e pose/deteccao
 *     apenas no primeiro (alvo 1000 ms);
 *   - frames pulados nao viram `subsistemasIndisponiveis` (nao sao falha).
 *
 * Os ciclos sao gravados em JSONL para o relatorio de cadencia:
 *   node scripts/benchmark-cadencia.mjs --ciclos <arquivo> --politica benchmark-5fps
 *
 * Opt-in (precisa de clipe; o modelo multimodal precisa estar online para a
 * interpretacao real):
 *   $env:E2E_WEBCAM_CLIP = "bench/videos/webcam-mudanca.webm"
 *   $env:E2E_WEBCAM_CHANNEL = "chrome"   # opcional (WebGPU)
 *   npx playwright test e2e/webcam-cadencia.spec.ts --workers=1
 */

const CLIP = env.E2E_WEBCAM_CLIP || undefined;
const CANAL = env.E2E_WEBCAM_CHANNEL || undefined;
const DEBUG = env.E2E_WEBCAM_DEBUG;
const PREFIXO = env.E2E_WEBCAM_EVENTOS || "logs/e2e-cadencia";

test.use(CANAL ? { channel: CANAL } : {});
test.describe.configure({ mode: "serial" });

type AmostragemSubsistema = {
  amostrados?: number;
  intervaloAlvoMs?: number;
  intervaloMedioMs?: number;
  fpsEfetivo?: number;
};

type PayloadCiclo = {
  sessionId?: string;
  cycleId?: string;
  iniciadoEm?: string;
  concluidoEm?: string;
  frameIds?: string[];
  observacoes?: number;
  eventosTemporais?: number;
  subsistemasIndisponiveis?: string[];
  erros?: Array<{ etapa?: string }>;
  metricas?: {
    totalMs?: number;
    multimodalMs?: number;
    amostragem?: {
      janelaMs?: number;
      porSubsistema?: Record<string, AmostragemSubsistema | undefined>;
    };
  };
  politica?: { id?: string };
  interpretacao?: string;
  cancelado?: boolean;
};

test("cadencia 5fps: plano independente por subsistema e registrado no ciclo", async ({ page }) => {
  test.skip(!CLIP, "defina E2E_WEBCAM_CLIP com o caminho de um clipe de bench/videos");
  if (!CLIP) return;
  test.setTimeout(900_000);

  const bytes = await readFile(CLIP);
  const ext = path.extname(CLIP).toLowerCase();
  const mime = ext === ".webm" ? "video/webm" : "video/mp4";
  const dataUrl = `data:${mime};base64,${bytes.toString("base64")}`;

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

  const ciclos: PayloadCiclo[] = [];
  if (DEBUG) {
    page.on("console", (m) => console.log(`[console:${m.type()}] ${m.text()}`));
    page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
  }
  page.on("request", (req) => {
    if (req.method() !== "POST") return;
    if (!req.url().endsWith("/api/ciclos")) return;
    try {
      ciclos.push(JSON.parse(req.postData() || "{}"));
    } catch {
      // ignora payloads nao-JSON
    }
  });

  await page.goto("/?benchmark=5fps");
  expect(
    await page.evaluate(() => globalThis.crossOriginIsolated),
    "COOP/COEP ausentes: o WASM multithread nao sera habilitado"
  ).toBe(true);

  // Intervalo entre ciclos de 1 s (nao interfere na janela interna de 0,8 s).
  await page.locator("#interval").evaluate((el) => {
    const input = el as HTMLInputElement;
    input.value = "1";
    input.dispatchEvent(new Event("input"));
  });
  await page.locator("#motor").selectOption("percepcao");

  await page.locator("#start").click();
  await expect(page.locator("#status")).toContainText("Ciclo ", { timeout: 600_000 });

  // Aquece a carga dos modelos, zera os buffers e roda ao menos um ciclo novo.
  ciclos.length = 0;
  const inicio = new Date().toISOString();
  await page.evaluate(() => (window as unknown as { __tocarClip: () => void }).__tocarClip());
  const limite = Date.now() + 300_000;
  const cicloDaCadencia = (c: PayloadCiclo): boolean =>
    c.cancelado !== true &&
    (c.frameIds?.length ?? 0) === 5 &&
    c.politica?.id === "benchmark-5fps" &&
    Boolean(c.metricas?.amostragem?.porSubsistema);
  while (Date.now() < limite && !ciclos.some(cicloDaCadencia)) {
    await page.waitForTimeout(2000);
  }

  await page.locator("#stop").click();
  await expect(page.locator("#start")).toBeEnabled();

  const doTeste = ciclos.filter((c) => cicloDaCadencia(c) || c.cancelado === true);
  const resumo = doTeste
    .map(
      (c) =>
        `${c.cycleId ?? "?"}: frames=${c.frameIds?.length ?? 0} obs=${c.observacoes ?? 0} ` +
        `politica=${c.politica?.id ?? "-"} amostragem=${c.metricas?.amostragem ? "sim" : "nao"}`
    )
    .join(" | ");
  expect(doTeste.length, `nenhum ciclo da politica benchmark-5fps. Ciclos: ${resumo}`).toBeGreaterThan(0);

  const ciclo = doTeste.find((c) => cicloDaCadencia(c));
  expect(ciclo, `nenhum ciclo com 5 frames e amostragem. Ciclos: ${resumo}`).toBeTruthy();
  if (!ciclo) return;

  const porSubsistema = ciclo.metricas?.amostragem?.porSubsistema ?? {};
  const maos = porSubsistema.maos;
  const pose = porSubsistema.pose;
  const deteccao = porSubsistema.deteccao;

  // Maos: alvo de 5 FPS (200 ms) e amostradas em todos os 5 frames da janela.
  expect(maos?.intervaloAlvoMs, "alvo de maos deve ser 200 ms").toBe(200);
  expect(maos?.amostrados, "maos devem ser amostradas em todos os 5 frames").toBe(5);
  // O jitter real da captura impede exigir exatamente 5.0; o alvo e 5 FPS e a
  // janela nominal de 0,8 s precisa render ao menos 4,5 FPS efetivos.
  expect(maos?.fpsEfetivo ?? 0, "FPS efetivo de amostragem das maos").toBeGreaterThanOrEqual(4.5);

  // Pose/deteccao: alvo de 1 Hz; so o primeiro frame (ancora) e amostrado.
  for (const [nome, metrica] of [
    ["pose", pose],
    ["deteccao", deteccao],
  ] as const) {
    expect(metrica?.intervaloAlvoMs, `alvo de ${nome} deve ser 1000 ms`).toBe(1000);
    expect(metrica?.amostrados, `${nome} deve ser amostrada apenas na ancora`).toBe(1);
  }

  // Pular pela cadencia nao e falha: nenhum subsistema vira "indisponivel".
  expect(ciclo.subsistemasIndisponiveis ?? []).toEqual([]);

  const destino = path.resolve(PREFIXO);
  await mkdir(path.dirname(destino), { recursive: true });
  const arquivo = `${destino}-5fps.ciclos.jsonl`;
  await writeFile(arquivo, ciclos.map((c) => JSON.stringify(c)).join("\n") + "\n", "utf8");
  await writeFile(`${arquivo}.inicio`, `${inicio}\n`, "utf8");

  console.log(`Cadencia 5fps — ciclos capturados: ${ciclos.length}`);
  console.log(`Salvos em ${arquivo}`);
  console.log(`Relatorio: node scripts/benchmark-cadencia.mjs --ciclos ${arquivo} --politica benchmark-5fps`);
});
