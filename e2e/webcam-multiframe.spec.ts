import { expect, test } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../src/env";

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
 */

const CLIP = env.E2E_WEBCAM_CLIP || undefined;
const CANAL = env.E2E_WEBCAM_CHANNEL || undefined;
const DEBUG = env.E2E_WEBCAM_DEBUG;
const PREFIXO = env.E2E_WEBCAM_EVENTOS || "logs/e2e-multiframe";

// Com canal instalado (ex.: "chrome") o WebGPU fica disponivel; sem ele,
// usamos o Chromium do Playwright (WASM/CPU) — mais lento, mas funcional.
test.use(CANAL ? { channel: CANAL } : {});

test.describe.configure({ mode: "serial" });

/** Modos multiframe e suas letras no benchmark (Etapa 9). */
const MODOS = [
  { id: "percepcao-sequencia", letra: "B" },
  { id: "percepcao-fundida", letra: "C" },
  { id: "percepcao", letra: "D" },
] as const;

type PayloadEvento = { tipo?: string; timestamp?: string; descricao?: string };
type PayloadLog = { resumo?: string; timestamp?: string; modelo?: string };
type PayloadCiclo = {
  sessionId?: string;
  cycleId?: string;
  iniciadoEm?: string;
  concluidoEm?: string;
  frameIds?: string[];
  observacoes?: number;
  eventosTemporais?: number;
  erros?: Array<{ etapa?: string }>;
  metricas?: Record<string, number | undefined>;
  interpretacao?: string;
  cancelado?: boolean;
};

for (const { id, letra } of MODOS) {
  test(`modo ${id} (variante ${letra}): 4 frames -> percepcao -> IA local -> ciclos`, async ({ page }) => {
    test.skip(!CLIP, "defina E2E_WEBCAM_CLIP com o caminho de um clipe de bench/videos");
    if (!CLIP) return;
    test.setTimeout(900_000);

    const bytes = await readFile(CLIP);
    const ext = path.extname(CLIP).toLowerCase();
    const mime = ext === ".webm" ? "video/webm" : "video/mp4";
    const dataUrl = `data:${mime};base64,${bytes.toString("base64")}`;

    // Replay: video oculto parado no 1o quadro; canvas redesenha e vira a
    // "camera" do getUserMedia. Sem WebGPU escondemos navigator.gpu para
    // forcar WASM (mesma estrategia do webcam.spec.ts).
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

    const eventos: PayloadEvento[] = [];
    const entradas: PayloadLog[] = [];
    const ciclos: PayloadCiclo[] = [];
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
        else if (url.endsWith("/api/log")) entradas.push(JSON.parse(body));
        else if (url.endsWith("/api/ciclos")) ciclos.push(JSON.parse(body));
      } catch {
        // ignora payloads nao-JSON
      }
    });

    await page.goto("/");
    // B/C sao categorias de benchmark e ficaram FORA do `<select id="motor">`
    // (nao sao escolhas de usuario; so `percepcao` aparece). O E2E injeta a
    // opcao de volta para medir cada variante sobre o mesmo clipe.
    await page.evaluate((id) => {
      const sel = document.querySelector("#motor") as HTMLSelectElement | null;
      if (sel && ![...sel.options].some((o) => o.value === id)) {
        const opt = document.createElement("option");
        opt.value = id;
        opt.textContent = `benchmark ${id}`;
        sel.appendChild(opt);
      }
    }, id);
    await page.locator("#motor").selectOption(id);
    // O seletor de modelo de visao fica em "Padrão do servidor": todas as
    // variantes usam o MESMA versão (o modelo efetivo do backend), que o
    // `app.ts` registra no campo `modelo` via `infoVisao.modelo` — é o que a
    // verificação de `--modelo-visao` confere em logs/visao.jsonl.
    // Intervalo entre ciclos de 1 s (seletor #interval). A janela do ciclo tem
    // 4 snapshots a 500 ms; o agendador respeita o piso de margem entre ciclos.
    await page.locator("#interval").evaluate((el) => {
      const input = el as HTMLInputElement;
      input.value = "1";
      input.dispatchEvent(new Event("input"));
    });

    // 1) Clipe parado no 1o quadro: espera o modelo carregar e o primeiro ciclo
    //    terminar (status "Ciclo <id>: ..."). So entao o clipe comeca a tocar.
    await page.locator("#start").click();
    await expect(page.locator("#status")).toContainText("Ciclo ", { timeout: 300_000 });

    // 2) Zera os buffers e toca o clipe do inicio; `inicio` e a base temporal.
    eventos.length = 0;
    entradas.length = 0;
    ciclos.length = 0;
    const inicio = new Date().toISOString();
    await page.evaluate(() => (window as unknown as { __tocarClip: () => void }).__tocarClip());

    const duracaoMs = await page.evaluate(() => {
      const d = (window as unknown as { __clipVideo?: HTMLVideoElement }).__clipVideo?.duration;
      return Number.isFinite(d) && d && d > 0 ? Math.ceil(d * 1000) : 30_000;
    });

    // 3) Espera o clipe inteiro passar e os ciclos lentos terminarem. No
    //    hardware de referencia um ciclo leva ~37 s (B) e ~95-140 s (C/D com
    //    deteccao em CPU), e a janela antiga (15 s / teto 180 s) parava o teste
    //    com o ciclo em voo — `stop` cancelava e a variante nao concluia nada
    //    pos-clipe (ver bench/RELATORIO_SMOKE_MULTIFRAME_2026-10-19.md).
    //    Agora: estabilidade de 180 s sem novos ciclos e teto de 300 s.
    await page.waitForTimeout(duracaoMs + 2000);
    let estavelDesde = Date.now();
    let vista = ciclos.length;
    const limite = Date.now() + 300_000;
    while (Date.now() < limite) {
      await page.waitForTimeout(2000);
      if (ciclos.length > vista) {
        vista = ciclos.length;
        estavelDesde = Date.now();
      } else if (Date.now() - estavelDesde >= 180_000) {
        break;
      }
    }

    await page.locator("#stop").click();
    await expect(page.locator("#start")).toBeEnabled();

    expect(
      ciclos.length,
      "nenhum ciclo foi persistido (POST /api/ciclos nao chegou — o modo multiframe nao rodou?)"
    ).toBeGreaterThan(0);

    // Fase 0 do roteiro de correcoes: "existe POST" nao prova que o ciclo
    // terminou. So conta ciclo nao cancelado, com os 4 frames, interpretacao
    // multimodal nao vazia e as metricas do ciclo preenchidas. Assim o E2E
    // falha quando o stop cancela o unico ciclo em voo (o defeito do smoke de
    // 2026-10-19) em vez de passar com zero ciclos concluidos.
    const concluidos = ciclos.filter((c) => c.cancelado !== true);
    const completos = concluidos.filter(
      (c) =>
        (c.frameIds?.length ?? 0) === 4 &&
        (c.observacoes ?? 0) === 4 &&
        Number.isFinite(c.metricas?.totalMs) &&
        Number.isFinite(c.metricas?.multimodalMs) &&
        typeof c.interpretacao === "string" &&
        c.interpretacao.trim().length > 0 &&
        typeof c.concluidoEm === "string" &&
        c.concluidoEm.length > 0 &&
        (letra === "B" ||
          (Number.isFinite(c.metricas?.deteccaoMs) &&
            Number.isFinite(c.metricas?.poseMs) &&
            Number.isFinite(c.metricas?.maosMs) &&
            Number.isFinite(c.metricas?.temporalMs)))
    );
    const resumo = ciclos
      .map(
        (c) =>
          `${c.cycleId ?? "?"}: cancelado=${c.cancelado === true} obs=${c.observacoes ?? 0} ` +
          `frames=${c.frameIds?.length ?? 0} interpretacao=${c.interpretacao ? "sim" : "nao"} ` +
          `totalMs=${c.metricas?.totalMs ?? "-"} multimodalMs=${c.metricas?.multimodalMs ?? "-"}`
      )
      .join(" | ");
    expect(
      concluidos.length,
      `nenhum ciclo CONCLUIDO (todos cancelados ou incompletos). Ciclos: ${resumo}`
    ).toBeGreaterThan(0);
    expect(
      completos.length,
      `nenhum ciclo concluido com 4 observacoes, interpretacao multimodal e metricas. Ciclos: ${resumo}`
    ).toBeGreaterThan(0);
    if (letra !== "B") {
      expect(
        completos.some((c) => Number(c.metricas?.deteccaoMs) > 0),
        `variante ${letra} sem deteccao local medida. Ciclos: ${resumo}`
      ).toBe(true);
    }

    // Grava eventos, entradas e ciclos em JSONL (prefixo configuravel).
    const destino = path.resolve(PREFIXO);
    const dir = path.dirname(destino);
    await mkdir(dir, { recursive: true });
    const raiz = path.join(dir, `${path.basename(destino)}-${id}`);
    const gravaJsonl = (arq: string, linhas: unknown[]) =>
      writeFile(arq, linhas.map((l) => JSON.stringify(l)).join("\n") + "\n");
    await gravaJsonl(`${raiz}.jsonl`, eventos);
    await gravaJsonl(`${raiz}.log.jsonl`, entradas);
    await gravaJsonl(`${raiz}.ciclos.jsonl`, ciclos);
    await writeFile(`${raiz}.inicio`, `${inicio}\n`);

    const base = Date.parse(inicio);
    const em = (ts?: string): number => (ts ? Math.round(Date.parse(ts) - base) : -1);
    const modelos = [...new Set(entradas.map((e) => e.modelo).filter(Boolean))];
    console.log(`modo ${id} (variante ${letra}) — inicio: ${inicio}`);
    console.log(
      `Ciclos persistidos: ${ciclos.length} | concluidos: ${concluidos.length} | completos: ${completos.length}`
    );
    for (const c of ciclos) {
      const total = c.metricas?.totalMs;
      console.log(
        `  +${em(c.iniciadoEm)}ms  ciclo ${c.cycleId ?? "?"} — obs=${c.observacoes ?? 0} eventos=${c.eventosTemporais ?? 0}` +
          `${total === undefined ? "" : ` total=${total}ms`}${c.cancelado ? " (cancelado)" : ""}` +
          `${c.erros?.length ? ` erros=[${c.erros.map((e) => e.etapa).join(", ")}]` : ""}`
      );
    }
    console.log(`Entradas (IA local): ${entradas.length} | modelos: ${modelos.join(", ") || "(nenhum)"}`);
    console.log(`Eventos: ${eventos.length}`);
    console.log(`Salvos em ${raiz}.{jsonl,log.jsonl,ciclos.jsonl}`);
    console.log(
      `Benchmark: node scripts/benchmark-variantes.mjs --ciclos-${letra} ${raiz}.ciclos.jsonl --variantes ${letra}`
    );
  });
}
