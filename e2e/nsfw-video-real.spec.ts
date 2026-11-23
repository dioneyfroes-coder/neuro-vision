import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import {
  formatarRelatorioRevisaoNsfwVideo,
  type AmostraParaRevisao,
  type MarcacaoParaRevisao,
  type MetadadosRevisaoNsfwVideo,
} from "../src/domain/relatorio-revisao-nsfw-video";
import { env } from "../src/env";
import { MODELO_NSFW } from "../src/nsfw-prompt";
import { MODELOS_NSFW_CONJUNTO } from "../public/nsfw-onnx";
import {
  criarServidorClipe,
  escutarServidorClipe,
  instalarReplayClipe,
  mimeDoClipe,
  type ServidorClipe,
} from "./helpers/webcam-clipe";

/**
 * E2E opt-in com um clipe adulto REAL de `bench/videos/` (nome começando com
 * `nsfw`). Não substitui o runtime: reproduce o arquivo como webcam, executa os
 * seis modelos NSFW locais em WASM e grava as marcações enviadas a `/api/visao`.
 *
 * O backend multimodal pode estar offline: nesse caso a descrição fica `N/A`,
 * mas as marcações continuam sendo resultados reais do classificador. Nenhuma
 * taxa de acerto é calculada — a folha `.revisao.md` deixa colunas em branco
 * para conferência humana.
 *
 *   $env:E2E_WEBCAM_CLIP = "bench/videos/nsfw - <arquivo>.mp4"
 *   $env:E2E_WEBCAM_DURATION_MS = "30000"
 *   $env:E2E_WEBCAM_EVENTOS = "logs/nsfw-video-real"
 *   npx playwright test e2e/nsfw-video-real.spec.ts --workers=1
 */

const CLIP = env.E2E_WEBCAM_CLIP || undefined;
const PREFIXO = env.E2E_WEBCAM_EVENTOS || "logs/nsfw-video-real";

type CorpoVisao = {
  capturadoEm?: string;
  frameIds?: string[];
  modelo?: string;
  contexto?: string;
  nsfw?: unknown;
};

type EventoResposta = {
  type?: string;
  descricao?: string;
  modelo?: string;
  ms?: number;
  erro?: string;
};

type RespostaVisao = { descricao?: string; latenciaMs?: number; modelo?: string };

async function sha256Arquivo(caminho: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(caminho), hash);
  return hash.digest("hex");
}

async function escreverLinhas(caminho: string, registros: readonly unknown[]): Promise<string> {
  const destino = path.resolve(caminho);
  const corpo = registros.map((registro) => JSON.stringify(registro)).join("\n");
  await writeFile(destino, corpo ? `${corpo}\n` : "", "utf8");
  return destino;
}

function marcacoesValidas(valor: unknown): MarcacaoParaRevisao[] {
  if (!Array.isArray(valor)) return [];
  const marcado: MarcacaoParaRevisao[] = [];
  for (const item of valor) {
    if (!item || typeof item !== "object") continue;
    const m = item as Record<string, unknown>;
    const caixa = m.caixa as Record<string, unknown> | undefined;
    if (
      typeof m.rotulo !== "string" ||
      !Number.isFinite(m.score) ||
      !caixa ||
      !["xmin", "ymin", "xmax", "ymax"].every((chave) => Number.isFinite(caixa[chave]))
    ) {
      continue;
    }
    marcado.push({
      rotulo: m.rotulo,
      score: m.score as number,
      caixa: {
        xmin: caixa.xmin as number,
        ymin: caixa.ymin as number,
        xmax: caixa.xmax as number,
        ymax: caixa.ymax as number,
      },
      ...(typeof m.modelo === "string" ? { modelo: m.modelo } : {}),
      ...(Array.isArray(m.modelos)
        ? { modelos: m.modelos.filter((nome): nome is string => typeof nome === "string") }
        : {}),
    });
  }
  return marcado;
}

test.describe("E2E NSFW com clipe adulto real", () => {
  let servidorClipe: ServidorClipe | undefined;

  test.afterEach(async () => {
    if (!servidorClipe) return;
    await new Promise<void>((resolve, reject) => {
      servidorClipe!.close((erro) => (erro ? reject(erro) : resolve()));
    });
    servidorClipe = undefined;
  });

  test("reproduz o clipe, executa os modelos locais e grava a folha de revisão", async ({ page }) => {
    test.skip(!CLIP, "defina E2E_WEBCAM_CLIP com um clipe nsfw* de bench/videos");
    if (!CLIP) return;
    test.setTimeout(900_000);

    const mime = mimeDoClipe(CLIP);
    servidorClipe = criarServidorClipe(CLIP, mime);
    const urlClipe = await escutarServidorClipe(servidorClipe);
    await instalarReplayClipe(page, urlClipe, true);

    const corpos: CorpoVisao[] = [];
    const eventos: unknown[] = [];
    const respostas: EventoResposta[] = [];
    const errosBackend: string[] = [];
    const respostasPorIndice: Array<RespostaVisao | undefined> = [];
    const indicePorRequisicao = new WeakMap<object, number>();
    const filaIndices: number[] = [];
    const pesosObservados = new Set<string>();
    const respostasPendentes: Promise<void>[] = [];
    let proximoIndiceVisao = 0;
    let requisicoesEmAndamento = 0;
    let respostasConcluidas = 0;
    let modeloEfetivo: string | undefined;
    let sha256 = "";
    let bytes = 0;
    let largura = 0;
    let altura = 0;
    let duracaoVideoMs = 0;
    let duracaoMs = 0;
    let duracaoReproduzidaMs = 0;
    let limiar = 0;
    let inicio = new Date(0).toISOString();
    let amostras: AmostraParaRevisao[] = [];

    const ehVisao = (url: string): boolean => url.endsWith("/api/visao");
    page.on("request", (req) => {
      const peso = req.url().match(/\/yolonsfw\/([A-Za-z0-9_]+)\.onnx$/);
      if (peso) pesosObservados.add(peso[1]);
      if (req.method() !== "POST") return;
      if (ehVisao(req.url())) {
        const indice = proximoIndiceVisao++;
        indicePorRequisicao.set(req, indice);
        filaIndices.push(indice);
        respostasPorIndice[indice] = undefined;
        requisicoesEmAndamento += 1;
        let corpo: CorpoVisao = {};
        try {
          corpo = JSON.parse(req.postData() || "{}") as CorpoVisao;
        } catch {
          // mantem a posicao mesmo sem payload interpretavel
        }
        corpos.push(corpo);
        return;
      }
      if (req.url().endsWith("/api/eventos")) {
        try {
          eventos.push(JSON.parse(req.postData() || "{}"));
        } catch {
          // ignora payloads nao-JSON
        }
      }
    });
    const concluir = (req: { url: () => string }): void => {
      if (ehVisao(req.url())) requisicoesEmAndamento = Math.max(0, requisicoesEmAndamento - 1);
    };
    page.on("requestfinished", concluir);
    page.on("requestfailed", concluir);
    page.on("response", (resposta) => {
      if (!ehVisao(resposta.url())) return;
      const req = resposta.request();
      const indice = indicePorRequisicao.get(req) ?? filaIndices.shift();
      respostasPendentes.push(
        resposta
          .text()
          .then((texto) => {
            if (!resposta.ok()) {
              let mensagem = texto.slice(0, 240);
              try {
                const json = JSON.parse(texto) as { erro?: string };
                if (json.erro) mensagem = json.erro;
              } catch {
                // mantem o trecho bruto curto
              }
              errosBackend.push(`HTTP ${resposta.status()}: ${mensagem}`);
              return;
            }
            for (const linha of texto.split(/\r?\n/)) {
              if (!linha.trim()) continue;
              let evento: EventoResposta;
              try {
                evento = JSON.parse(linha) as EventoResposta;
              } catch {
                continue;
              }
              respostas.push(evento);
              if (evento.type !== "done") continue;
              respostasConcluidas += 1;
              if (evento.modelo) modeloEfetivo = evento.modelo;
              if (indice !== undefined) {
                respostasPorIndice[indice] = {
                  descricao: evento.descricao,
                  latenciaMs: evento.ms,
                  modelo: evento.modelo,
                };
              }
            }
          })
          .catch((erro: Error) => {
            errosBackend.push(`leitura da resposta: ${erro.message}`);
          })
      );
    });

    try {
      sha256 = await sha256Arquivo(CLIP);
      bytes = (await stat(CLIP)).size;

      await page.goto("/");
      await page.locator("#motor").selectOption("visao");
      await page.locator("#nsfw").check();
      await expect(page.locator("#status")).toContainText("conjunto NSFW");
      limiar = Number(await page.locator("#threshold").inputValue());
      await page.locator("#interval").evaluate((el) => {
        const input = el as HTMLInputElement;
        input.value = "1";
        input.dispatchEvent(new Event("input"));
      });

      // Warm-up fora da janela medida: carrega os pesos e aquece o WASM.
      await page.locator("#start").click();
      await expect(page.locator("#status")).toContainText(/viu:/i, { timeout: 300_000 });
      await expect
        .poll(
          () =>
            MODELOS_NSFW_CONJUNTO.filter((modelo) => pesosObservados.has(modelo)).length,
          { timeout: 300_000 }
        )
        .toBe(MODELOS_NSFW_CONJUNTO.length);
      await page.locator("#stop").click();
      await expect(page.locator("#start")).toBeEnabled();
      await Promise.all(respostasPendentes.splice(0));

      // A janela medida começa com os buffers vazios.
      corpos.length = 0;
      eventos.length = 0;
      respostas.length = 0;
      errosBackend.length = 0;
      respostasPorIndice.length = 0;
      filaIndices.length = 0;
      proximoIndiceVisao = 0;
      respostasConcluidas = 0;
      modeloEfetivo = undefined;

      const dimensoes = await page.evaluate(() => {
        const video = (window as unknown as { __clipVideo?: HTMLVideoElement }).__clipVideo;
        return {
          largura: video?.videoWidth ?? 0,
          altura: video?.videoHeight ?? 0,
          duracaoMs: video?.duration ? Math.ceil(video.duration * 1000) : 0,
        };
      });
      largura = dimensoes.largura;
      altura = dimensoes.altura;
      duracaoVideoMs = dimensoes.duracaoMs;
      expect(duracaoVideoMs, "o navegador não conseguiu ler a duração do clipe").toBeGreaterThan(0);

      const limite = env.E2E_WEBCAM_DURATION_MS;
      expect(
        Number.isInteger(limite) && limite >= 0 && (limite === 0 || limite >= 1000),
        "E2E_WEBCAM_DURATION_MS precisa ser 0 ou um inteiro de pelo menos 1000 ms"
      ).toBe(true);
      duracaoMs = limite > 0 ? Math.min(duracaoVideoMs, limite) : duracaoVideoMs;

      inicio = new Date().toISOString();
      await page.evaluate(
        (duracao) =>
          (window as unknown as { __tocarClip: (duracaoMs?: number) => void }).__tocarClip(duracao),
        duracaoMs
      );
      await page.locator("#start").click();
      await page.waitForTimeout(duracaoMs + 3000);
      duracaoReproduzidaMs = await page.evaluate(
        () =>
          ((window as unknown as { __clipVideo?: HTMLVideoElement }).__clipVideo?.currentTime ?? 0) * 1000
      );
      if (limite > 0 && limite < duracaoVideoMs) {
        expect(duracaoReproduzidaMs).toBeGreaterThanOrEqual(duracaoMs - 1000);
        expect(duracaoReproduzidaMs).toBeLessThanOrEqual(duracaoMs + 1000);
      }

      const limiteEspera = Date.now() + 300_000;
      while (requisicoesEmAndamento > 0 && Date.now() < limiteEspera) {
        await page.waitForTimeout(1000);
      }
      expect(requisicoesEmAndamento, "uma requisição /api/visao não terminou").toBe(0);
      await Promise.all(respostasPendentes.splice(0));
      await page.locator("#stop").click();
      await expect(page.locator("#start")).toBeEnabled();

      const inicioMs = Date.parse(inicio);
      const fimMs = inicioMs + duracaoMs;
      amostras = corpos.flatMap((corpo, indice): AmostraParaRevisao[] => {
        if (!Array.isArray(corpo.nsfw) || !corpo.capturadoEm) return [];
        const capturadoMs = Date.parse(corpo.capturadoEm);
        if (!Number.isFinite(capturadoMs) || capturadoMs < inicioMs || capturadoMs > fimMs) return [];
        const frameId = corpo.frameIds?.[0];
        const resposta = respostasPorIndice[indice];
        return [
          {
            offsetMs: Math.round(capturadoMs - inicioMs),
            capturadoEm: corpo.capturadoEm,
            ...(frameId ? { frameId } : {}),
            ...(corpo.modelo ? { modelo: corpo.modelo } : {}),
            ...(resposta?.descricao ? { descricao: resposta.descricao } : {}),
            ...(Number.isFinite(resposta?.latenciaMs) ? { latenciaMs: resposta!.latenciaMs } : {}),
            marcacoes: marcacoesValidas(corpo.nsfw),
          },
        ];
      });

      expect(amostras.length, "nenhum frame com campo NSFW foi enviado ao backend").toBeGreaterThan(0);
      expect(
        amostras.some((amostra) => amostra.modelo === MODELO_NSFW),
        "o cliente não enviou o Gemma configurado para o fluxo NSFW"
      ).toBe(true);
    } finally {
      const prefixo = path.resolve(PREFIXO);
      await mkdir(path.dirname(prefixo), { recursive: true });
      const artefatos = [
        await escreverLinhas(`${prefixo}.deteccoes.jsonl`, corpos),
        await escreverLinhas(`${prefixo}.eventos.jsonl`, eventos),
        await escreverLinhas(`${prefixo}.respostas.jsonl`, respostas),
        await escreverLinhas(`${prefixo}.erros-backend.jsonl`, errosBackend),
      ];
      const meta: MetadadosRevisaoNsfwVideo = {
        clip: CLIP ? path.basename(CLIP) : "N/A",
        sha256,
        bytes,
        largura,
        altura,
        duracaoVideoMs,
        duracaoMs,
        duracaoReproduzidaMs,
        inicio,
        limiar,
        modelosSolicitados: MODELOS_NSFW_CONJUNTO,
        modelosObservados: [...pesosObservados].sort(),
        ...(modeloEfetivo ? { modeloEfetivo } : {}),
        respostasConcluidas,
        errosBackend,
        artefatos: artefatos.map((artefato) => path.relative(process.cwd(), artefato)),
      };
      const revisao = path.resolve(`${prefixo}.revisao.md`);
      await writeFile(
        revisao,
        formatarRelatorioRevisaoNsfwVideo(meta, amostras),
        "utf8"
      );
      console.log(`Folha de revisão: ${path.relative(process.cwd(), revisao)}`);
      console.log(`Amostras: ${amostras.length} · pesos: ${meta.modelosObservados.join(", ") || "nenhum"}`);
      console.log(
        `Backend: ${respostasConcluidas} resposta(s) concluída(s); ` +
          `${errosBackend.length} erro(s) registrado(s)`
      );
    }
  });
});
