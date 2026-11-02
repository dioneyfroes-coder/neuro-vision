import { expect, test } from "@playwright/test";
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../src/env";
import type { MarcacaoNsfwLog } from "../src/types";

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
 *   npx playwright test e2e/webcam.spec.ts --workers=1
 *
 * Para coletar a variante A do benchmark:
 *   $env:E2E_WEBCAM_MODE = "eventos"
 *   $env:E2E_WEBCAM_EVENTOS = "logs/fase5-A-car-detection.jsonl"
 *   npx playwright test e2e/webcam.spec.ts --workers=1
 * A execução prepara o modelo, aquece o detector fora da sessão medida e salva
 * também `.ciclos.jsonl`, com latência observada desde a captura até a resposta.
 */

const CLIP = env.E2E_WEBCAM_CLIP || undefined;
const CANAL = env.E2E_WEBCAM_CHANNEL || undefined;
const DEBUG = env.E2E_WEBCAM_DEBUG;
const MODO = env.E2E_WEBCAM_MODE;
const MODELO_VISAO = env.E2E_WEBCAM_MODEL || undefined;
const NSFW_ATIVO = env.E2E_WEBCAM_NSFW;
const LIMIAR = env.E2E_WEBCAM_THRESHOLD;
const VARIANTE_BASELINE = MODO === "eventos";

type PayloadAnalise = {
  resumo?: string;
  timestamp?: string;
  capturadoEm?: string;
  modelo?: string;
  tipo?: string;
  ms?: number;
  sessaoId?: string;
  frameId?: string;
  nsfw?: MarcacaoNsfwLog[];
};

// Com um canal instalado (ex.: "chrome") o WebGPU fica disponivel; sem ele,
// usamos o Chromium do Playwright (WASM/CPU). Precisa ser de nivel superior.
test.use(CANAL ? { channel: CANAL } : {});

test.describe("avaliacao com clipe real de webcam", () => {
  let servidorClipe: ReturnType<typeof createServer> | undefined;

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

    const extensao = path.extname(CLIP).toLowerCase();
    const mime = extensao === ".webm" ? "video/webm" : extensao === ".mp4" ? "video/mp4" : null;
    if (!mime) throw new Error(`formato de clipe nao suportado: ${extensao || "(sem extensao)"}`);
    const tamanhoClipe = statSync(CLIP).size;
    servidorClipe = createServer((req, res) => {
      if (req.url !== "/clip") {
        res.writeHead(404).end();
        return;
      }
      const cabecalhos = {
        "Access-Control-Allow-Origin": "*",
        "Accept-Ranges": "bytes",
        "Content-Type": mime,
      };
      const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
      if (req.headers.range && !range) {
        res.writeHead(416, { "Content-Range": `bytes */${tamanhoClipe}` }).end();
        return;
      }
      if (range) {
        const tamanhoSufixo = range[2] ? Number(range[2]) : 0;
        const inicioRange = range[1]
          ? Number(range[1])
          : Math.max(0, tamanhoClipe - tamanhoSufixo);
        const fimRange = range[1] && range[2]
          ? Math.min(Number(range[2]), tamanhoClipe - 1)
          : tamanhoClipe - 1;
        if (
          !Number.isInteger(inicioRange) ||
          !Number.isInteger(fimRange) ||
          inicioRange > fimRange ||
          inicioRange >= tamanhoClipe
        ) {
          res.writeHead(416, { "Content-Range": `bytes */${tamanhoClipe}` }).end();
          return;
        }
        res.writeHead(206, {
          ...cabecalhos,
          "Content-Length": fimRange - inicioRange + 1,
          "Content-Range": `bytes ${inicioRange}-${fimRange}/${tamanhoClipe}`,
        });
        createReadStream(CLIP, { start: inicioRange, end: fimRange }).pipe(res);
        return;
      }
      res.writeHead(200, { ...cabecalhos, "Content-Length": tamanhoClipe });
      createReadStream(CLIP).pipe(res);
    });
    await new Promise<void>((resolve, reject) => {
      servidorClipe!.once("error", reject);
      servidorClipe!.listen(0, "127.0.0.1", resolve);
    });
    const enderecoClipe = servidorClipe.address();
    if (!enderecoClipe || typeof enderecoClipe === "string") {
      throw new Error("nao foi possivel iniciar servidor local do clipe");
    }
    const urlClipe = `http://127.0.0.1:${enderecoClipe.port}/clip`;

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
        video.crossOrigin = "anonymous";
        video.src = src;

        const janela = window as unknown as {
          __clipVideo: HTMLVideoElement;
          __tocarClip: (duracaoMs?: number) => void;
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

        janela.__tocarClip = (duracaoMs) => {
          video.currentTime = 0;
          if (duracaoMs && duracaoMs < video.duration * 1000) {
            window.setTimeout(() => video.pause(), duracaoMs);
          }
          void video.play();
        };

        navigator.mediaDevices.getUserMedia = async () => {
          await pronto;
          return canvas.captureStream(15);
        };
      },
      { src: urlClipe, semGpu: !CANAL }
    );

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
    if (!VARIANTE_BASELINE) {
      expect(eventosDoClipe.length, "nenhum evento foi capturado (a deteccao nao rodou?)").toBeGreaterThan(0);
    }
    if (VARIANTE_BASELINE) {
      const diagnosticoAnalises = JSON.stringify({
        janela: { inicio, fim: new Date(fimClipeMs).toISOString() },
        recebidas: analises.map(({ capturadoEm, frameId, modelo, tipo }) => ({
          capturadoEm,
          frameId,
          modelo,
          tipo,
        })),
      });
      expect(
        analisesDoClipe.some(
          (a) =>
            a.tipo === "descricao" &&
            typeof a.frameId === "string" &&
            typeof a.modelo === "string" &&
            Number.isFinite(a.ms) &&
            (a.ms ?? -1) >= 0
        ),
        `nenhuma resposta multimodal real da variante A foi capturada dentro do clipe: ${diagnosticoAnalises}`
      ).toBe(true);
    }
    if (MODELO_VISAO) {
      expect(
        analisesDoClipe.some((a) => a.modelo === MODELO_VISAO),
        `nenhuma resposta foi produzida pelo modelo solicitado ${MODELO_VISAO}`
      ).toBe(true);
    }
    if (NSFW_ATIVO) {
      expect(
        analisesDoClipe.some((a) => Array.isArray(a.nsfw)),
        "nenhuma resposta incluiu o campo do marcador NSFW"
      ).toBe(true);
    }

    const destino = path.resolve(env.E2E_WEBCAM_EVENTOS || "logs/webcam-eventos.jsonl");
    await mkdir(path.dirname(destino), { recursive: true });
    await writeFile(destino, eventosDoClipe.map((e) => JSON.stringify(e)).join("\n") + "\n");
    await writeFile(
      `${destino}.analises.jsonl`,
      analisesDoClipe.map((a) => JSON.stringify(a)).join("\n") + "\n"
    );
    // Base para os offsets `em` da anotacao (instante em que o clipe tocou).
    await writeFile(`${destino}.inicio`, `${inicio}\n`);
    await writeFile(
      `${destino}.config.json`,
      JSON.stringify(
        {
          clip: path.basename(CLIP),
          modo: MODO,
          limiar: LIMIAR,
          modeloVisao: MODELO_VISAO,
          nsfw: NSFW_ATIVO,
          inicio,
          duracaoVideoMs,
          duracaoMs,
          duracaoReproduzidaMs: Math.round(duracaoReproduzidaMs),
        },
        null,
        2
      ) + "\n"
    );
    if (VARIANTE_BASELINE) {
      const ciclos = analisesDoClipe
        .filter(
          (a) =>
            a.tipo === "descricao" &&
            typeof a.frameId === "string" &&
            typeof a.timestamp === "string" &&
            typeof a.capturadoEm === "string" &&
            typeof a.modelo === "string" &&
            a.modelo.length > 0 &&
            Number.isFinite(a.ms) &&
            (a.ms ?? -1) >= 0 &&
            Number.isFinite(Date.parse(a.timestamp)) &&
            Number.isFinite(Date.parse(a.capturadoEm)) &&
            Date.parse(a.timestamp) >= Date.parse(a.capturadoEm)
        )
        .map((a) => {
          const fimMs = Date.parse(a.timestamp!);
          const capturaMs = Date.parse(a.capturadoEm!);
          const totalMs = fimMs - capturaMs;
          const sessionId = a.sessaoId || `variante-a-${Date.parse(inicio)}`;
          return {
            sessionId,
            cycleId: a.frameId!,
            iniciadoEm: new Date(capturaMs).toISOString(),
            concluidoEm: a.timestamp,
            frameIds: [a.frameId!],
            observacoes: 1,
            eventosTemporais: 0,
            subsistemasIndisponiveis: [],
            erros: [],
            metricas: {
              totalMs,
              multimodalMs: a.ms!,
            },
            interpretacao: a.resumo,
            configuracao: {
              varianteId: "baseline",
              quantidadeSnapshotsConfigurada: 1,
              intervaloEntreSnapshotsMs: 1000,
              ...(a.modelo ? { modeloMultimodalEfetivo: a.modelo } : {}),
            },
            cancelado: false,
            registroEm: a.timestamp,
          };
        });
      await writeFile(
        `${destino}.ciclos.jsonl`,
        ciclos.map((c) => JSON.stringify(c)).join("\n") + "\n"
      );
      console.log(`Amostras da variante A: ${ciclos.length} | salvas em ${destino}.ciclos.jsonl`);
    }

    const base = inicioMs;
    const em = (ts?: string): number => (ts ? Math.round(Date.parse(ts) - base) : -1);
    console.log(`inicio (base da anotacao): ${inicio}`);
    console.log(`Limiar de deteccao: ${LIMIAR}`);
    console.log(`Modelo de visao: ${MODELO_VISAO ?? "(padrao do servidor)"}`);
    console.log(`Marcador NSFW: ${NSFW_ATIVO ? "ligado" : "desligado"}`);
    console.log(`Duracao reproduzida: ${Math.round(duracaoReproduzidaMs)}ms de ${duracaoVideoMs}ms`);
    console.log(`Analises do clipe: ${analisesDoClipe.length}`);
    for (const a of analisesDoClipe) console.log(`  +${em(a.timestamp)}ms  ${a.resumo ?? ""}`);
    console.log(`Eventos do clipe: ${eventosDoClipe.length}`);
    for (const e of eventosDoClipe) console.log(`  +${em(e.timestamp)}ms  ${e.tipo}  ${e.descricao ?? ""}`);
    console.log(`Analises do clipe: ${analisesDoClipe.length}`);
    for (const a of analisesDoClipe) {
      const marcacoes = a.nsfw?.map((marcacao) => marcacao.rotulo).join(", ") || "nenhuma";
      console.log(`  +${em(a.capturadoEm)}ms  ${a.modelo}  NSFW: ${marcacoes}  ${a.resumo ?? ""}`);
    }
    console.log(`Salvos em ${destino}`);
    console.log(`Analises salvas em ${destino}.analises.jsonl`);
    console.log(`Compare: npm run qualidade -- --anotacao <clipe>.json --eventos ${destino}`);
  });
});
