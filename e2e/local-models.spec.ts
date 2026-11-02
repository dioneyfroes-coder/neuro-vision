import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../src/env";

type CicloPersistido = {
  cancelado?: boolean;
  observacoes?: number;
  metricas?: {
    interpretacaoSuprimida?: string;
    cargaModelos?: {
      subsistemas?: Partial<
        Record<
          "deteccao" | "pose" | "maos",
          {
            status?: string;
            modelo?: string;
            dispositivo?: string;
            versao?: string;
            tempoCargaMs?: number;
          }
        >
      >;
    };
    inferenciaPorSnapshotMs?: Partial<Record<"deteccao" | "pose" | "maos", number>>;
    resultadosPercepcao?: {
      deteccao: { quadrosValidos: number; deteccoes: number };
      pose: {
        quadrosValidos: number;
        pessoas: number;
        keypoints: number;
        pessoasCom17Keypoints: number;
      };
      maos: {
        quadrosValidos: number;
        maos: number;
        landmarks: number;
        maosCom21Landmarks: number;
      };
    };
  };
};

const CLIP = env.E2E_LOCAL_MODELS_CLIP || undefined;
const CANAL = env.E2E_LOCAL_MODELS_CHANNEL || undefined;
const DEBUG = env.E2E_WEBCAM_DEBUG;
test.use(CANAL ? { channel: CANAL } : {});

test("modelos locais reais: carrega, infere e libera os tres subsistemas", async ({ page }) => {
  test.skip(!CLIP, "defina E2E_LOCAL_MODELS_CLIP com um clipe local de pessoa e mao visivel");
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
          // O navegador pode expor uma propriedade nao configuravel.
        }
      }

      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      video.src = src;
      const pronto = new Promise<boolean>((resolve) => {
        if (video.readyState >= 2) {
          resolve(true);
          return;
        }
        video.addEventListener("loadeddata", () => resolve(true), { once: true });
        video.addEventListener("error", () => resolve(false), { once: true });
      });

      const canvas = document.createElement("canvas");
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

      navigator.mediaDevices.getUserMedia = async () => {
        if (!(await pronto)) throw new Error("nao foi possivel decodificar o clipe de teste");
        return canvas.captureStream(15);
      };

      const workers: Array<{ script: string; encerramentos: number }> = [];
      const janela = window as unknown as {
        __workersModelosLocais: typeof workers;
        __clipPronto: Promise<boolean>;
      };
      janela.__workersModelosLocais = workers;
      janela.__clipPronto = pronto;
      const WorkerOriginal = window.Worker;
      window.Worker = new Proxy(WorkerOriginal, {
        construct(target, args: ConstructorParameters<typeof Worker>) {
          const worker = Reflect.construct(target, args);
          const registro = { script: String(args[0]), encerramentos: 0 };
          const encerrarOriginal = worker.terminate.bind(worker);
          worker.terminate = () => {
            registro.encerramentos += 1;
            encerrarOriginal();
          };
          workers.push(registro);
          return worker;
        },
      });
    },
    { src: dataUrl, semGpu: !CANAL }
  );

  const ciclos: CicloPersistido[] = [];
  const assetsLocais = new Set<string>();
  if (DEBUG) {
    page.on("pageerror", (error) => console.error(`[pageerror] ${error.message}`));
    page.on("console", (mensagem) => {
      if (mensagem.type() === "error") console.error(`[console] ${mensagem.text()}`);
    });
    page.on("requestfailed", (request) =>
      console.error(`[requestfailed] ${request.url()}: ${request.failure()?.errorText}`)
    );
  }
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() === "POST" && url.pathname === "/api/ciclos") {
      const body = request.postData();
      if (body) ciclos.push(JSON.parse(body) as CicloPersistido);
    }
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (
      response.status() === 200 &&
      (url.pathname.startsWith("/modelos/") || url.pathname.startsWith("/vendor/"))
    ) {
      assetsLocais.add(url.pathname);
    }
  });

  await page.goto("/");
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as unknown as { __clipPronto: Promise<boolean> }).__clipPronto
        ),
      { timeout: 30_000, message: "o navegador nao conseguiu decodificar o clipe configurado" }
    )
    .toBe(true);
  await page.locator("#motor").selectOption("percepcao");
  await page.locator("#interval").evaluate((el) => {
    const input = el as HTMLInputElement;
    input.value = "1";
    input.dispatchEvent(new Event("input"));
  });
  await page.locator("#start").click();

  await expect
    .poll(() => ciclos.find((ciclo) => !ciclo.cancelado && ciclo.observacoes === 4), {
      timeout: 600_000,
      message: "os tres modelos locais nao concluiram um ciclo real de quatro frames",
    })
    .toBeTruthy();

  const ciclo = ciclos.find((item) => !item.cancelado && item.observacoes === 4);
  expect(ciclo?.metricas?.cargaModelos?.subsistemas).toMatchObject({
    deteccao: { status: "ok", modelo: "onnx-community/yolov10n", versao: "1.21.0" },
    pose: { status: "ok", modelo: "Xenova/yolov8n-pose", versao: "3.8.1" },
    maos: { status: "ok", versao: "0.10.21" },
  });

  const modelos = ciclo?.metricas?.cargaModelos?.subsistemas;
  expect(modelos?.deteccao?.dispositivo).toMatch(/^(wasm|webgpu)$/);
  expect(modelos?.pose?.dispositivo).toMatch(/^(wasm|webgpu)$/);
  expect(modelos?.maos?.dispositivo).toMatch(/^(cpu|gpu)$/i);
  expect(ciclo?.metricas?.inferenciaPorSnapshotMs).toEqual(
    expect.objectContaining({
      deteccao: expect.any(Number),
      pose: expect.any(Number),
      maos: expect.any(Number),
    })
  );
  for (const subsistema of ["deteccao", "pose", "maos"] as const) {
    expect(modelos?.[subsistema]?.tempoCargaMs, `carga fria de ${subsistema}`).toBeGreaterThan(0);
    expect(
      ciclo?.metricas?.inferenciaPorSnapshotMs?.[subsistema],
      `inferencia aquecida de ${subsistema}`
    ).toBeGreaterThan(0);
  }
  expect(ciclo?.metricas?.interpretacaoSuprimida).toBe("politica_sob_demanda");

  const resultados = ciclo?.metricas?.resultadosPercepcao;
  expect(resultados?.deteccao.quadrosValidos).toBeGreaterThan(0);
  expect(resultados?.deteccao.deteccoes).toBeGreaterThan(0);
  expect(resultados?.pose.quadrosValidos).toBeGreaterThan(0);
  expect(resultados?.pose.pessoas).toBeGreaterThan(0);
  expect(resultados?.pose.pessoasCom17Keypoints).toBe(resultados?.pose.pessoas);
  expect(resultados?.maos.quadrosValidos).toBeGreaterThan(0);
  expect(resultados?.maos.maosCom21Landmarks).toBe(resultados?.maos.maos);
  if (env.E2E_LOCAL_MODELS_REQUIRE_HAND) {
    expect(resultados?.maos.maos, "o clipe configurado precisa mostrar uma mao detectavel").toBeGreaterThan(0);
  }

  expect([...assetsLocais]).toEqual(
    expect.arrayContaining([
      expect.stringContaining("/modelos/coco/yolov10n.onnx"),
      expect.stringContaining("/modelos/pose/Xenova/yolov8n-pose/"),
      expect.stringContaining("/modelos/maos/gesture_recognizer.task"),
      expect.stringContaining("/vendor/onnxruntime/"),
      expect.stringContaining("/vendor/transformers/"),
      expect.stringContaining("/vendor/mediapipe/"),
    ])
  );

  await page.locator("#stop").click();
  await expect(page.locator("#start")).toBeEnabled();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as {
            __workersModelosLocais: Array<{ script: string; encerramentos: number }>;
          }).__workersModelosLocais
            .filter((worker) => worker.script.includes("/workers/"))
            .every((worker) => worker.encerramentos > 0)
      ),
      { timeout: 30_000, message: "os workers locais continuaram ativos depois de parar" }
    )
    .toBe(true);

  const workers = await page.evaluate(
    () =>
      (window as unknown as {
        __workersModelosLocais: Array<{ script: string; encerramentos: number }>;
      }).__workersModelosLocais
  );
  const workersAplicacao = workers.filter((worker) => new URL(worker.script).pathname.startsWith("/workers/"));
  expect(workersAplicacao.length).toBeGreaterThanOrEqual(3);
  expect(workersAplicacao.every((worker) => worker.encerramentos > 0)).toBe(true);
  console.log(
    JSON.stringify(
      {
        modelos,
        resultados,
        assetsLocais: [...assetsLocais],
        workers,
        workersAplicacao,
      },
      null,
      2
    )
  );
});
