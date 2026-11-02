#!/usr/bin/env node

/**
 * Verificacao empirica do classificador **NSFW experimental**.
 *
 * Espelha `scripts/verificar-yolo-onnx.mjs`, mas usa os pesos LOCAIS exportados
 * por `scripts/exportar-yolo-nsfw.mjs` (`modelos/yolonsfw/*.onnx`, gitignored) e
 * os rotulos do sidecar `<modelo>.onnx.json`. A inferencia roda em WASM **no
 * Chromium** (mesmo runtime/caminho de producao) sobre um frame real de
 * `bench/videos/frames/`. O pre-pos-processamento espelha `public/nsfw-onnx.ts`:
 *   stretch 640x640 -> /255 RGB NCHW -> saida [1, 300, 6] -> caixas na
 *   resolucao original, com NMS embutido no export.
 *
 * Sai com codigo 1 se a carga falhar, se a saida nao tiver a forma esperada,
 * se alguma caixa sair dos limites ou se o modelo devolver rotulo desconhecido
 * (`classe N`) — sinal de sidecar ausente/divergente.
 *
 * Uso: node scripts/verificar-yolo-nsfw.mjs [modelo] [frame.jpg] [limiar]
 */

import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST_ORT = path.join(ROOT, "node_modules", "onnxruntime-web", "dist");
const DIR_PESOS = path.join(ROOT, "modelos", "yolonsfw");

const MIME_ENTRADAS = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};
const EXTENSOES_VIDEO = new Set([".mp4", ".webm"]);
const MIME = {
  ".mjs": "application/javascript",
  ".js": "application/javascript",
  ".wasm": "application/wasm",
  ".onnx": "application/octet-stream",
  ".json": "application/json",
  ...MIME_ENTRADAS,
  ".html": "text/html; charset=utf-8",
};

export function obterMimeEntrada(caminho) {
  return MIME_ENTRADAS[path.extname(caminho).toLowerCase()];
}

export function validarAmostras(valor) {
  const amostras = Number(valor);
  if (!Number.isInteger(amostras) || amostras < 1 || amostras > 30) {
    throw new Error("--amostras precisa ser um inteiro entre 1 e 30");
  }
  return amostras;
}

export function parsearArgumentos(argumentos) {
  const config = {
    modelo: "erax_nsfw_yolo11n",
    entradas: [],
    limiar: 0.5,
    amostras: 5,
    fixturesNsfw: false,
    ajuda: false,
  };
  let i = 0;
  if (argumentos[0] && !argumentos[0].startsWith("-")) {
    config.modelo = argumentos[0];
    i = 1;
  }
  let limiarDefinido = false;
  for (; i < argumentos.length; i += 1) {
    const argumento = argumentos[i];
    if (argumento === "--help" || argumento === "-h") {
      config.ajuda = true;
    } else if (argumento === "--fixtures-nsfw") {
      config.fixturesNsfw = true;
    } else if (argumento === "--amostras") {
      const valor = argumentos[++i];
      if (valor === undefined) throw new Error("--amostras precisa de um valor");
      config.amostras = validarAmostras(valor);
    } else if (argumento === "--limiar") {
      const valor = Number(argumentos[++i]);
      if (!Number.isFinite(valor) || valor < 0 || valor > 1) {
        throw new Error("--limiar precisa estar entre 0 e 1");
      }
      config.limiar = valor;
      limiarDefinido = true;
    } else if (argumento.startsWith("-")) {
      throw new Error(`opcao desconhecida: ${argumento}`);
    } else if (Number.isFinite(Number(argumento))) {
      const valor = Number(argumento);
      if (limiarDefinido || valor < 0 || valor > 1) {
        throw new Error("limiar posicional duplicado ou fora do intervalo [0,1]");
      }
      config.limiar = valor;
      limiarDefinido = true;
    } else {
      config.entradas.push(argumento);
    }
  }
  return config;
}

async function descobrirFixturesNsfw() {
  const diretorios = ["bench/imagens", "bench/videos"];
  const entradas = [];
  for (const diretorio of diretorios) {
    const caminho = path.resolve(ROOT, diretorio);
    const arquivos = await readdir(caminho, { withFileTypes: true });
    entradas.push(
      ...arquivos
        .filter(
          (arquivo) =>
            arquivo.isFile() &&
            /^nsfw/i.test(arquivo.name) &&
            obterMimeEntrada(arquivo.name)
        )
        .map((arquivo) => path.join(caminho, arquivo.name))
    );
  }
  return entradas.sort((a, b) => a.localeCompare(b));
}

/**
 * Pagina que espelha o pre-pos-processamento de `public/nsfw-onnx.ts`.
 * Sem template literals dentro do cliente (o HTML e montado com crace).
 */
const PAGINA = `<!doctype html>
<meta charset="utf-8">
<title>verificar-yolo-nsfw</title>
<script type="module">
  import * as ort from "/ort/ort.min.mjs";
  ort.env.wasm.wasmPaths = "/ort/";

  const LADO = 640;

  function paraTensor(rgba) {
    const plano = LADO * LADO;
    const dados = new Float32Array(3 * plano);
    for (let i = 0; i < plano; i++) {
      dados[i] = rgba[i * 4] / 255;
      dados[plano + i] = rgba[i * 4 + 1] / 255;
      dados[2 * plano + i] = rgba[i * 4 + 2] / 255;
    }
    return dados;
  }

  // Espelho de interpretarSaidaYolo (forma [1, 300, 6]) com rotulos do sidecar.
  function interpretar(cru, dims, limiar, largura, altura, rotulos) {
    const transposto = dims[1] === 6;
    const colunas = transposto ? 6 : dims[dims.length - 1];
    const linhas = transposto ? dims[dims.length - 1] : dims[dims.length - 2];
    const indice = (linha, coluna) =>
      transposto ? coluna * linhas + linha : linha * colunas + coluna;
    const ex = largura / LADO;
    const ey = altura / LADO;
    const saida = [];
    for (let i = 0; i < linhas; i++) {
      const score = cru[indice(i, 4)];
      if (!(score >= limiar)) continue;
      const classe = Math.round(cru[indice(i, 5)]);
      saida.push({
        label: rotulos[classe] || "classe " + classe,
        score: Math.round(score * 1000) / 1000,
        xmin: Math.round(Math.max(0, cru[indice(i, 0)] * ex) * 10) / 10,
        ymin: Math.round(Math.max(0, cru[indice(i, 1)] * ey) * 10) / 10,
        xmax: Math.round(Math.min(largura, cru[indice(i, 2)] * ex) * 10) / 10,
        ymax: Math.round(Math.min(altura, cru[indice(i, 3)] * ey) * 10) / 10,
      });
    }
    return saida;
  }

  window.__iniciar = async (rotulos, limiar, entradas, amostras) => {
    const canvas = typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(LADO, LADO)
      : Object.assign(document.createElement("canvas"), { width: LADO, height: LADO });
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    const inicioCarga = performance.now();
    const sessao = await ort.InferenceSession.create("/modelo.onnx", {
      executionProviders: ["wasm"],
    });
    const msCarga = Math.round(performance.now() - inicioCarga);
    async function inferir(origem, largura, altura, emSegundos) {
      ctx.drawImage(origem, 0, 0, LADO, LADO);
      const dados = paraTensor(ctx.getImageData(0, 0, LADO, LADO).data);
      const feeds = {};
      feeds[sessao.inputNames[0]] = new ort.Tensor("float32", dados, [1, 3, LADO, LADO]);
      const inicio = performance.now();
      const resultado = await sessao.run(feeds);
      const msInferencia = Math.round(performance.now() - inicio);
      const tensor = resultado[sessao.outputNames[0]];
      return {
        emSegundos,
        largura,
        altura,
        msInferencia,
        dims: Array.from(tensor.dims),
        deteccoes: interpretar(tensor.data, tensor.dims, limiar, largura, altura, rotulos),
      };
    }
    const resultados = [];
    for (const entrada of entradas) {
      const frames = [];
      if (entrada.video) {
        const video = document.createElement("video");
        video.muted = true;
        video.preload = "auto";
        video.src = entrada.url;
        await new Promise((resolve, reject) => {
          video.onloadedmetadata = resolve;
          video.onerror = () => reject(new Error("nao foi possivel decodificar " + entrada.nome));
        });
        const quantidade = Math.min(amostras, Math.max(1, Math.floor(video.duration)));
        for (let i = 0; i < quantidade; i += 1) {
          const emSegundos = (video.duration * (i + 1)) / (quantidade + 1);
          await new Promise((resolve, reject) => {
            video.onseeked = resolve;
            video.onerror = () => reject(new Error("falha ao buscar quadro de " + entrada.nome));
            video.currentTime = emSegundos;
          });
          frames.push(await inferir(video, video.videoWidth, video.videoHeight, emSegundos));
        }
      } else {
        const img = new Image();
        img.src = entrada.url;
        await img.decode();
        frames.push(await inferir(img, img.naturalWidth, img.naturalHeight, null));
      }
      resultados.push({ nome: entrada.nome, frames });
    }
    return {
      msCarga,
      resultados,
    };
  };
  window.__carregada = true;
</script>`;

async function servir(porta, modelo, entradas) {
  const html = Buffer.from(PAGINA, "utf8");
  const pesos = await readFile(modelo);
  const servidor = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/") {
      res.writeHead(200, { "content-type": MIME[".html"] });
      res.end(html);
      return;
    }
    if (url.pathname === "/modelo.onnx") {
      res.writeHead(200, { "content-type": MIME[".onnx"], "content-length": pesos.length });
      res.end(pesos);
      return;
    }
    const indiceEntrada = url.pathname.match(/^\/entrada\/(\d+)$/);
    if (indiceEntrada) {
      const entrada = entradas[Number(indiceEntrada[1])];
      if (!entrada) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, {
        "content-type": obterMimeEntrada(entrada),
        "content-length": statSync(entrada).size,
      });
      createReadStream(entrada).pipe(res);
      return;
    }
    if (url.pathname.startsWith("/ort/")) {
      const arquivo = path.join(DIST_ORT, path.basename(url.pathname));
      if (!arquivo.startsWith(DIST_ORT) || !existsSync(arquivo)) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, {
        "content-type": MIME[path.extname(arquivo)] || "application/octet-stream",
      });
      createReadStream(arquivo).pipe(res);
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((ok) => servidor.listen(porta, "127.0.0.1", ok));
  return servidor;
}

async function main() {
  const config = parsearArgumentos(process.argv.slice(2));
  if (config.ajuda) {
    console.log(
      "Uso: node scripts/verificar-yolo-nsfw.mjs [modelo] [imagem|video ...] [limiar] [--amostras N] [--fixtures-nsfw]"
    );
    return;
  }
  const chave = path.basename(config.modelo).replace(/\.onnx$/i, "");
  if (!/^[\w.-]+$/i.test(chave)) throw new Error("nome de modelo invalido");
  const modelo = path.join(DIR_PESOS, `${chave}.onnx`);
  const sidecar = `${modelo}.json`;
  const entradasArg =
    config.fixturesNsfw
      ? [...config.entradas, ...(await descobrirFixturesNsfw())]
      : config.entradas.length
        ? config.entradas
        : ["bench/videos/frames/frame-1.jpg"];
  if (!entradasArg.length) throw new Error("nenhuma fixture NSFW encontrada");
  const entradas = entradasArg.map((arquivo) => path.resolve(ROOT, arquivo));

  if (!existsSync(modelo)) {
    console.error(`Modelo nao encontrado: ${path.relative(ROOT, modelo)}`);
    console.error("Exporte com: node scripts/exportar-yolo-nsfw.mjs");
    process.exit(1);
  }
  if (!existsSync(sidecar)) {
    console.error(`Sidecar de classes ausente: ${path.relative(ROOT, sidecar)}`);
    console.error("Reexporte com: node scripts/exportar-yolo-nsfw.mjs");
    process.exit(1);
  }
  for (const [indice, entrada] of entradas.entries()) {
    if (!existsSync(entrada)) throw new Error(`arquivo nao encontrado: ${entradasArg[indice]}`);
    if (!obterMimeEntrada(entrada)) throw new Error(`formato nao suportado: ${entradasArg[indice]}`);
  }

  const rotulos = JSON.parse(await readFile(sidecar, "utf8")).classes;
  if (!Array.isArray(rotulos) || rotulos.length === 0) {
    console.error("Sidecar sem classes validas.");
    process.exit(1);
  }

  const servidor = await servir(0, modelo, entradas);
  const porta = servidor.address().port;
  const navegador = await chromium.launch();
  try {
    const pagina = await navegador.newPage();
    const errosDePagina = [];
    pagina.on("pageerror", (e) => errosDePagina.push(String(e)));
    await pagina.goto(`http://127.0.0.1:${porta}/`);
    await pagina.waitForFunction(() => window.__carregada === true, null, { timeout: 60_000 });
    const r = await pagina.evaluate(
      ([rotulos, limiar, arquivos, amostras]) =>
        window.__iniciar(
          rotulos,
          limiar,
          arquivos.map((arquivo, indice) => ({
            nome: arquivo.nome,
            url: `/entrada/${indice}`,
            video: arquivo.video,
          })),
          amostras
        ),
      [
        rotulos,
        config.limiar,
        entradas.map((arquivo) => ({
          nome: path.relative(ROOT, arquivo),
          video: EXTENSOES_VIDEO.has(path.extname(arquivo).toLowerCase()),
        })),
        config.amostras,
      ]
    );

    if (errosDePagina.length) {
      console.error("Erros na pagina:", errosDePagina.join(" | "));
      process.exit(1);
    }

    console.log(`Modelo: ${chave}.onnx | classes: ${rotulos.join(", ")}`);
    console.log(`Carga: ${r.msCarga} ms | limiar: ${config.limiar} | execucao: WASM`);
    const quadros = r.resultados.flatMap((entrada) =>
      entrada.frames.map((frame) => ({ ...frame, nome: entrada.nome }))
    );
    for (const entrada of r.resultados) {
      const deteccoes = entrada.frames.flatMap((frame) => frame.deteccoes);
      const resumo = Object.entries(
        deteccoes.reduce((contagem, deteccao) => {
          contagem[deteccao.label] = (contagem[deteccao.label] ?? 0) + 1;
          return contagem;
        }, {})
      )
        .map(([rotulo, quantidade]) => `${rotulo}:${quantidade}`)
        .join(", ");
      console.log(
        `${entrada.nome}: ${entrada.frames.length} quadro(s), ${deteccoes.length} marcacao(oes)` +
          (resumo ? ` (${resumo})` : " (nenhuma marcacao)")
      );
    }

    const formaInvalida = quadros.find(
      (frame) => frame.dims.length < 2 || frame.dims[frame.dims.length - 1] !== 6
    );
    const fora = quadros.some((frame) =>
      frame.deteccoes.some(
        (d) => d.xmin < 0 || d.ymin < 0 || d.xmax > frame.largura || d.ymax > frame.altura
      )
    );
    const rotuloDesconhecido = quadros.some((frame) =>
      frame.deteccoes.some((d) => /^classe /.test(d.label))
    );
    if (formaInvalida) {
      console.error(`FALHA: saida com forma inesperada (${formaInvalida.dims.join("x")}).`);
      process.exit(1);
    }
    if (fora) {
      console.error("FALHA: caixa fora dos limites do frame.");
      process.exit(1);
    }
    if (rotuloDesconhecido) {
      console.error("FALHA: rotulo desconhecido (sidecar ausente/divergente).");
      process.exit(1);
    }
    console.log("OK: saida valida, caixas dentro dos limites e rotulos do sidecar.");
  } finally {
    await navegador.close();
    servidor.close();
  }
}

const caminhoDoModulo = fileURLToPath(import.meta.url);
const executadoDiretamente =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === caminhoDoModulo;

if (executadoDiretamente) {
  main().catch((erro) => {
    console.error(erro);
    process.exit(1);
  });
}
