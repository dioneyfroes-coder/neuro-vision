import { expect, test } from "@playwright/test";
import { env } from "../src/env";
import type { MarcacaoNsfwLog } from "../src/types";
import {
  CLIP,
  CANAL,
  DEBUG,
  mimeDoClipe,
  criarServidorClipe,
  escutarServidorClipe,
  instalarReplayClipe,
  configurarInterface,
  prepararEAquecer,
  validarResultados,
  salvarArtefatos,
  imprimirResumo,
  type PayloadAnalise,
  type ServidorClipe,
} from "./helpers/webcam-clipe";

/**
 * Avaliacao com clipe REAL de webcam (Fase 7).
 *
 * Diferente de `app.spec.ts`, este teste **nao** substitui o runtime: ele usa o
 * YOLOv10n real em ONNX (onnxruntime-web + pesos do Hugging Face) e reproduz
 * um clipe `.webm` ou `.mp4` como se fosse a
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
 *   npx playwright test e2e/webcam.spec.ts (helper em e2e/helpers/webcam-clipe.ts) --workers=1
 *
 * Para coletar a variante A do benchmark:
 *   $env:E2E_WEBCAM_MODE = "eventos"
 *   $env:E2E_WEBCAM_EVENTOS = "logs/fase5-A-car-detection.jsonl"
 *   npx playwright test e2e/webcam.spec.ts --workers=1
 * A execução prepara o modelo, aquece o detector fora da sessão medida e salva
 * também `.ciclos.jsonl`, com latência observada desde a captura até a resposta.
 */

test.use(CANAL ? { channel: CANAL } : {});

test.describe("avaliacao com clipe real de webcam", () => {
  let servidorClipe: ServidorClipe | undefined;
  test.afterEach(async () => {
    if (!servidorClipe) return;
    await new Promise<void>((resolve, reject) => {
      servidorClipe!.close((erro) => (erro ? reject(erro) : resolve()));
    });
    servidorClipe = undefined;
  });

  test("reproduz o clipe e grava os eventos reais", async ({ page }) => {
    test.skip(!CLIP, "defina E2E_WEBCAM_CLIP com o caminho de um .webm gravado");
    if (!CLIP) return;
    test.setTimeout(900_000);

    const mime = mimeDoClipe(CLIP);
    servidorClipe = criarServidorClipe(CLIP, mime);
    const urlClipe = await escutarServidorClipe(servidorClipe);
    await instalarReplayClipe(page, urlClipe, !CANAL);

    const eventos: Array<{ tipo?: string; timestamp?: string; descricao?: string }> = [];
    const analises: PayloadAnalise[] = [];
    let requisicoesVisaoEmAndamento = 0;
    const eRequisicaoVisao = (req: { url: () => string }) => req.url().endsWith("/api/visao");
    if (DEBUG) {
      page.on("console", (m) => console.log(`[console:${m.type()}] ${m.text()}`));
      page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
    }
    page.on("request", (req) => {
      if (req.method() === "POST" && eRequisicaoVisao(req)) requisicoesVisaoEmAndamento += 1;
      if (req.method() !== "POST") return;
      const url = req.url();
      const body = req.postData() || "{}";
      try {
        if (url.endsWith("/api/eventos")) eventos.push(JSON.parse(body));
      } catch {
        // ignora payloads nao-JSON
      }
    });
    const concluirRequisicaoVisao = (req: { url: () => string }) => {
      if (eRequisicaoVisao(req)) {
        requisicoesVisaoEmAndamento = Math.max(0, requisicoesVisaoEmAndamento - 1);
      }
    };
    page.on("requestfinished", concluirRequisicaoVisao);
    page.on("requestfailed", concluirRequisicaoVisao);
    const respostasVisao: Promise<void>[] = [];
    page.on("response", (resposta) => {
      const requisicao = resposta.request();
      if (requisicao.method() !== "POST" || !eRequisicaoVisao(requisicao)) return;
      const payload = JSON.parse(requisicao.postData() || "{}") as {
        capturadoEm?: string;
        frameIds?: string[];
      };
      respostasVisao.push(
        resposta.text().then((corpo) => {
          for (const linha of corpo.split(/\r?\n/).filter(Boolean)) {
            let evento: {
              type?: string;
              descricao?: string;
              modelo?: string;
              ms?: number;
              tipo?: string;
              nsfw?: MarcacaoNsfwLog[];
            };
            try {
              evento = JSON.parse(linha) as typeof evento;
            } catch (err) {
              throw new Error(`resposta NDJSON invalida de /api/visao: ${linha}`, { cause: err });
            }
            if (evento.type === "done") {
              analises.push({
                capturadoEm: payload.capturadoEm,
                frameId: payload.frameIds?.[0],
                timestamp: new Date().toISOString(),
                resumo: evento.descricao,
                modelo: evento.modelo,
                ms: evento.ms,
                tipo: evento.tipo,
                nsfw: evento.nsfw,
              });
            }
          }
        })
      );
    });

    await configurarInterface(page);

    await prepararEAquecer(page);

    // 2) Zera a captura, toca o clipe e inicia uma sessao nova. Assim, a
    // primeira chamada automatica da politica pertence ao proprio clipe.
    eventos.length = 0;
    analises.length = 0;
    const limiteDuracaoMs = env.E2E_WEBCAM_DURATION_MS;
    if (
      !Number.isInteger(limiteDuracaoMs) ||
      limiteDuracaoMs < 0 ||
      (limiteDuracaoMs > 0 && limiteDuracaoMs < 1000)
    ) {
      throw new Error("E2E_WEBCAM_DURATION_MS precisa ser 0 ou um inteiro de pelo menos 1000 ms");
    }
    const duracaoVideoMs = await page.evaluate(() => {
      const d = (window as unknown as { __clipVideo?: HTMLVideoElement }).__clipVideo?.duration;
      return Number.isFinite(d) && d && d > 0 ? Math.ceil(d * 1000) : 30_000;
    });
    const duracaoMs =
      limiteDuracaoMs > 0 ? Math.min(duracaoVideoMs, limiteDuracaoMs) : duracaoVideoMs;
    const inicio = new Date().toISOString();
    await page.evaluate(
      (duracao) =>
        (window as unknown as { __tocarClip: (duracaoMs?: number) => void }).__tocarClip(duracao),
      duracaoMs
    );
    await page.locator("#start").click();

    await page.waitForTimeout(duracaoMs + 3000);
    const duracaoReproduzidaMs = await page.evaluate(
      () => ((window as unknown as { __clipVideo?: HTMLVideoElement }).__clipVideo?.currentTime ?? 0) * 1000
    );
    if (limiteDuracaoMs > 0 && limiteDuracaoMs < duracaoVideoMs) {
      expect(duracaoReproduzidaMs).toBeGreaterThanOrEqual(duracaoMs - 1000);
      expect(duracaoReproduzidaMs).toBeLessThanOrEqual(duracaoMs + 1000);
    }
    const inicioMs = Date.parse(inicio);
    const fimClipeMs = inicioMs + duracaoMs;
    const limiteRequisicaoMs = Date.now() + 300_000;
    while (requisicoesVisaoEmAndamento > 0 && Date.now() < limiteRequisicaoMs) {
      await page.waitForTimeout(1000);
    }
    expect(
      requisicoesVisaoEmAndamento,
      "uma requisição multimodal não terminou antes do limite de espera"
    ).toBe(0);
    await Promise.all(respostasVisao);
    await page.locator("#stop").click();
    await expect(page.locator("#start")).toBeEnabled();

    const eventosDoClipe = eventos.filter((e) => {
      const timestampMs = e.timestamp ? Date.parse(e.timestamp) : NaN;
      return Number.isFinite(timestampMs) && timestampMs >= inicioMs && timestampMs <= fimClipeMs;
    });
    const analisesDoClipe = analises.filter((a) => {
      const capturadoMs = a.capturadoEm ? Date.parse(a.capturadoEm) : NaN;
      return Number.isFinite(capturadoMs) && capturadoMs >= inicioMs && capturadoMs <= fimClipeMs;
    });

    validarResultados({
      eventosDoClipe,
      analisesDoClipe,
      analises,
      inicio,
      fimClipeMs,
    });
    const destino = await salvarArtefatos({
      clip: CLIP,
      eventosDoClipe,
      analisesDoClipe,
      inicio,
      duracaoVideoMs,
      duracaoMs,
      duracaoReproduzidaMs,
    });
    imprimirResumo({
      inicio,
      inicioMs,
      duracaoReproduzidaMs,
      duracaoVideoMs,
      analisesDoClipe,
      eventosDoClipe,
      destino,
    });

  });
});
