import { expect, type Page } from "@playwright/test";
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../../src/env";
import type { MarcacaoNsfwLog } from "../../src/types";

export type ServidorClipe = ReturnType<typeof createServer>;

export const CLIP = env.E2E_WEBCAM_CLIP || undefined;
export const CANAL = env.E2E_WEBCAM_CHANNEL || undefined;
export const DEBUG = env.E2E_WEBCAM_DEBUG;
export const MODO = env.E2E_WEBCAM_MODE;
export const MODELO_VISAO = env.E2E_WEBCAM_MODEL || undefined;
export const NSFW_ATIVO = env.E2E_WEBCAM_NSFW;
export const LIMIAR = env.E2E_WEBCAM_THRESHOLD;
export const VARIANTE_BASELINE = MODO === "eventos";

export type PayloadAnalise = {
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

export function mimeDoClipe(clip: string): string {
    const extensao = path.extname(clip).toLowerCase();
    const mime = extensao === ".webm" ? "video/webm" : extensao === ".mp4" ? "video/mp4" : null;
    if (!mime) throw new Error(`formato de clipe nao suportado: ${extensao || "(sem extensao)"}`);
  return mime;
}

export function criarServidorClipe(clip: string, mime: string): ServidorClipe {
    const tamanhoClipe = statSync(clip).size;
    return createServer((req, res) => {
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
        createReadStream(clip, { start: inicioRange, end: fimRange }).pipe(res);
        return;
      }
      res.writeHead(200, { ...cabecalhos, "Content-Length": tamanhoClipe });
      createReadStream(clip).pipe(res);
    });
}

export async function escutarServidorClipe(servidor: ServidorClipe): Promise<string> {
    await new Promise<void>((resolve, reject) => {
      servidor.once("error", reject);
      servidor.listen(0, "127.0.0.1", resolve);
    });
    const enderecoClipe = servidor.address();
    if (!enderecoClipe || typeof enderecoClipe === "string") {
      throw new Error("nao foi possivel iniciar servidor local do clipe");
    }
    return `http://127.0.0.1:${enderecoClipe.port}/clip`;
}

export async function instalarReplayClipe(
  page: Page,
  urlClipe: string,
  semGpu: boolean
): Promise<void> {
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
      { src: urlClipe, semGpu }
    );
}

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

interface ContextoValidacao {
  eventosDoClipe: Array<{ tipo?: string; timestamp?: string; descricao?: string }>;
  analisesDoClipe: PayloadAnalise[];
  analises: PayloadAnalise[];
  inicio: string;
  fimClipeMs: number;
}

export function validarResultados({
  eventosDoClipe,
  analisesDoClipe,
  analises,
  inicio,
  fimClipeMs,
}: ContextoValidacao): void {
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
}

interface ContextoArtefatos {
  clip: string;
  eventosDoClipe: Array<{ tipo?: string; timestamp?: string; descricao?: string }>;
  analisesDoClipe: PayloadAnalise[];
  inicio: string;
  duracaoVideoMs: number;
  duracaoMs: number;
  duracaoReproduzidaMs: number;
}

export async function salvarArtefatos({
  clip,
  eventosDoClipe,
  analisesDoClipe,
  inicio,
  duracaoVideoMs,
  duracaoMs,
  duracaoReproduzidaMs,
}: ContextoArtefatos): Promise<string> {
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
          clip: path.basename(clip),
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
  return destino;
}

interface ContextoResumo {
  inicio: string;
  inicioMs: number;
  duracaoReproduzidaMs: number;
  duracaoVideoMs: number;
  analisesDoClipe: PayloadAnalise[];
  eventosDoClipe: Array<{ tipo?: string; timestamp?: string; descricao?: string }>;
  destino: string;
}

export function imprimirResumo({
  inicio,
  inicioMs,
  duracaoReproduzidaMs,
  duracaoVideoMs,
  analisesDoClipe,
  eventosDoClipe,
  destino,
}: ContextoResumo): void {
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
}
