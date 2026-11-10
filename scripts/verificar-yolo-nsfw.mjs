#!/usr/bin/env node

/**
 * Verificacao empirica do classificador **NSFW experimental**.
 *
 * Espelha `scripts/verificar-yolo-onnx.mjs`, mas usa os pesos LOCAIS exportados
 * por `scripts/exportar-yolo-nsfw.mjs` (`modelos/yolonsfw/*.onnx`, gitignored) e
 * os rotulos do sidecar `<modelo>.onnx.json`. A inferencia roda em WASM **no
 * Chromium** (mesmo runtime/caminho de producao) sobre um frame real de
 * `bench/videos/frames/`. O pre-pos-processamento espelha `public/nsfw-onnx.ts`:
 *   stretch quadrado -> /255 RGB NCHW -> caixas na resolucao original.
 *
 * Dois formatos de saida sao aceitos, como no cliente:
 *   - `[1, 300, 6]` (EraX e NudeNet 640m exportado): NMS embutido;
 *   - `[1, 22, N]` (NudeNet 320n): 4 coordenadas + 18 classes, com NMS em JS.
 *
 * O lado da entrada vem do nome do modelo: `nudenet_320n` usa 320x320; os
 * demais usam 640x640. Limiares por classe seguem `LIMIARES_NSFW` do cliente.
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

/** Lado da entrada: NudeNet 320n usa 320x320; o restante usa 640x640. */
export function ladoDoModelo(chave) {
  return /320n/i.test(chave) ? 320 : 640;
}

export function parsearArgumentos(argumentos) {
  const config = {
    modelo: "erax_nsfw_yolo11n",
    entradas: [],
    limiar: 0.5,
    amostras: 5,
    fixturesNsfw: false,
    detalhado: false,
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
    } else if (argumento === "--detalhado" || argumento === "-v") {
      config.detalhado = true;
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

  // Mesmos pisos de LIMIARES_NSFW em public/nsfw-onnx.ts. Classes ausentes usam
  // o limiar global passado na linha de comando.
  const LIMIARES = {
    penis: 0.25,
    vagina: 0.25,
    anus: 0.25,
    make_love: 0.35,
    nipple: 0.5,
    MALE_GENITALIA_EXPOSED: 0.2,
    FEMALE_GENITALIA_EXPOSED: 0.2,
    FEMALE_GENITALIA_COVERED: 0.15,
    ANUS_EXPOSED: 0.2,
    BUTTOCKS_EXPOSED: 0.2,
    FEMALE_BREAST_EXPOSED: 0.5,
    MALE_BREAST_EXPOSED: 0.5,
    ANUS_COVERED: 0.3,
    BUTTOCKS_COVERED: 0.3,
    FEMALE_BREAST_COVERED: 0.4,
  };

  function limiarDe(rotulo, global) {
    return LIMIARES[rotulo] !== undefined ? LIMIARES[rotulo] : global;
  }

  function sigmoid(valor) {
    return 1 / (1 + Math.exp(-valor));
  }

  // Mesma tolerancia de public/nsfw-onnx.ts: residuos float32 negativos nao
  // podem disparar o sigmoid e criar falsos positivos em 0,5.
  const TOLERANCIA_PROBABILIDADE = 1e-3;

  function saidaCruaUsaLogits(cru, linhas, indice) {
    for (let i = 0; i < linhas; i++) {
      for (let c = 0; c < 18; c++) {
        const valor = cru[indice(i, 4 + c)];
        if (!Number.isFinite(valor)) continue;
        if (valor < -TOLERANCIA_PROBABILIDADE || valor > 1 + TOLERANCIA_PROBABILIDADE) {
          return true;
        }
      }
    }
    return false;
  }

  function iou(a, b) {
    const x1 = Math.max(a.xmin, b.xmin);
    const y1 = Math.max(a.ymin, b.ymin);
    const x2 = Math.min(a.xmax, b.xmax);
    const y2 = Math.min(a.ymax, b.ymax);
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const areaA = Math.max(0, a.xmax - a.xmin) * Math.max(0, a.ymax - a.ymin);
    const areaB = Math.max(0, b.xmax - b.xmin) * Math.max(0, b.ymax - b.ymin);
    return inter / (areaA + areaB - inter + 1e-9);
  }

  // NMS por rotulo: classes diferentes nao se suprimem.
  function nmsPorRotulo(deteccoes, limite) {
    const grupos = new Map();
    for (const d of deteccoes) {
      const lista = grupos.get(d.label) || [];
      lista.push(d);
      grupos.set(d.label, lista);
    }
    const saida = [];
    for (const lista of grupos.values()) {
      const ordenada = lista.slice().sort((a, b) => b.score - a.score);
      const mantidas = [];
      for (const candidata of ordenada) {
        if (mantidas.every((m) => iou(candidata, m) <= limite)) mantidas.push(candidata);
      }
      saida.push.apply(saida, mantidas);
    }
    return saida.sort((a, b) => b.score - a.score);
  }

  function caixa(cx, cy, larguraCaixa, alturaCaixa, ex, ey, largura, altura) {
    return {
      xmin: Math.round(Math.max(0, Math.min(largura, (cx - larguraCaixa / 2) * ex)) * 10) / 10,
      ymin: Math.round(Math.max(0, Math.min(altura, (cy - alturaCaixa / 2) * ey)) * 10) / 10,
      xmax: Math.round(Math.max(0, Math.min(largura, (cx + larguraCaixa / 2) * ex)) * 10) / 10,
      ymax: Math.round(Math.max(0, Math.min(altura, (cy + alturaCaixa / 2) * ey)) * 10) / 10,
    };
  }

  // Saida com NMS embutido: [1, 300, 6] = x1,y1,x2,y2,score,classe.
  function interpretarNms(cru, dims, limiar, largura, altura, rotulos, lado) {
    const transposto = dims[1] === 6;
    const colunas = transposto ? 6 : dims[dims.length - 1];
    const linhas = transposto ? dims[dims.length - 1] : dims[dims.length - 2];
    const indice = (linha, coluna) =>
      transposto ? coluna * linhas + linha : linha * colunas + coluna;
    const ex = largura / lado;
    const ey = altura / lado;
    const saida = [];
    for (let i = 0; i < linhas; i++) {
      const score = cru[indice(i, 4)];
      const classe = Math.round(cru[indice(i, 5)]);
      const rotulo = rotulos[classe] || "classe " + classe;
      if (!(score >= limiarDe(rotulo, limiar))) continue;
      // NMS do export devolve xyxy, nao cx,cy,w,h.
      const b = {
        xmin: Math.round(Math.max(0, Math.min(largura, cru[indice(i, 0)] * ex)) * 10) / 10,
        ymin: Math.round(Math.max(0, Math.min(altura, cru[indice(i, 1)] * ey)) * 10) / 10,
        xmax: Math.round(Math.max(0, Math.min(largura, cru[indice(i, 2)] * ex)) * 10) / 10,
        ymax: Math.round(Math.max(0, Math.min(altura, cru[indice(i, 3)] * ey)) * 10) / 10,
      };
      saida.push({ label: rotulo, score: Math.round(score * 1000) / 1000, ...b });
    }
    return saida;
  }

  // Saida crua YOLOv8/NudeNet: [1, 22, N] = 4 coords + 18 classes.
  function interpretarCru(cru, dims, limiar, largura, altura, rotulos, lado) {
    const transposto = dims[1] === 22;
    const linhas = transposto ? dims[dims.length - 1] : dims[dims.length - 2];
    const indice = (linha, coluna) =>
      transposto ? coluna * linhas + linha : linha * 22 + coluna;
    const ex = largura / lado;
    const ey = altura / lado;
    const candidatas = [];
    let minScore = Infinity;
    let maxScore = -Infinity;
    let linhasSigmoid = 0;
    const usaLogits = saidaCruaUsaLogits(cru, linhas, indice);
    for (let i = 0; i < linhas; i++) {
      const scores = new Array(18);
      for (let c = 0; c < 18; c++) {
        const valor = cru[indice(i, 4 + c)];
        scores[c] = usaLogits ? sigmoid(valor) : valor;
        if (valor < minScore) minScore = valor;
        if (valor > maxScore) maxScore = valor;
      }
      if (usaLogits) linhasSigmoid += 1;
      let melhor = 0;
      let score = scores[0];
      for (let c = 1; c < 18; c++) {
        if (scores[c] > score) {
          score = scores[c];
          melhor = c;
        }
      }
      if (!Number.isFinite(score)) continue;
      score = Math.min(1, Math.max(0, score));
      const rotulo = rotulos[melhor] || "classe " + melhor;
      if (!(score >= limiarDe(rotulo, limiar))) continue;
      const b = caixa(
        cru[indice(i, 0)], cru[indice(i, 1)], cru[indice(i, 2)], cru[indice(i, 3)],
        ex, ey, largura, altura
      );
      if (b.xmax <= b.xmin || b.ymax <= b.ymin) continue;
      candidatas.push({ label: rotulo, score: Math.round(score * 1000) / 1000, ...b });
    }
    const nms = nmsPorRotulo(candidatas, 0.45);
    if (typeof window !== "undefined") {
      window.__debugCru = { linhas, linhasSigmoid, minScore, maxScore };
    }
    return nms;
  }

  function interpretar(cru, dims, limiar, largura, altura, rotulos, lado) {
    const ultima = dims[dims.length - 1];
    const crua = dims[1] === 22 || ultima === 22;
    return crua
      ? interpretarCru(cru, dims, limiar, largura, altura, rotulos, lado)
      : interpretarNms(cru, dims, limiar, largura, altura, rotulos, lado);
  }

  // Mesmas classes ignoradas do cliente (rosto, pes, barriga, axila).
  const CLASSES_IGNORADAS = new Set([
    "FACE_FEMALE",
    "FACE_MALE",
    "FEET_EXPOSED",
    "FEET_COVERED",
    "BELLY_COVERED",
    "BELLY_EXPOSED",
    "ARMPITS_COVERED",
    "ARMPITS_EXPOSED",
  ]);

  function filtrarRelevantes(deteccoes) {
    return deteccoes.filter((d) => !CLASSES_IGNORADAS.has(d.label));
  }

  function paraTensor(rgba, lado) {
    const plano = lado * lado;
    const dados = new Float32Array(3 * plano);
    for (let i = 0; i < plano; i++) {
      dados[i] = rgba[i * 4] / 255;
      dados[plano + i] = rgba[i * 4 + 1] / 255;
      dados[2 * plano + i] = rgba[i * 4 + 2] / 255;
    }
    return dados;
  }

  window.__iniciar = async (rotulos, limiar, entradas, amostras, lado) => {
    const canvas = typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(lado, lado)
      : Object.assign(document.createElement("canvas"), { width: lado, height: lado });
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    const inicioCarga = performance.now();
    const sessao = await ort.InferenceSession.create("/modelo.onnx", {
      executionProviders: ["wasm"],
    });
    const msCarga = Math.round(performance.now() - inicioCarga);
    async function inferir(origem, largura, altura, emSegundos) {
      ctx.drawImage(origem, 0, 0, lado, lado);
      const rgba = ctx.getImageData(0, 0, lado, lado).data;
      // Assinatura barata do frame: detecta seek que nao atualiza a imagem.
      let assinatura = 0;
      for (let i = 0; i < rgba.length; i += 997) assinatura = (assinatura * 31 + rgba[i]) >>> 0;
      const dados = paraTensor(rgba, lado);
      const feeds = {};
      feeds[sessao.inputNames[0]] = new ort.Tensor("float32", dados, [1, 3, lado, lado]);
      const inicio = performance.now();
      const resultado = await sessao.run(feeds);
      const msInferencia = Math.round(performance.now() - inicio);
      const tensor = resultado[sessao.outputNames[0]];
      const deteccoes = filtrarRelevantes(
        interpretar(tensor.data, tensor.dims, limiar, largura, altura, rotulos, lado)
      );
      return {
        emSegundos,
        largura,
        altura,
        msInferencia,
        assinatura,
        dims: Array.from(tensor.dims),
        debug: window.__debugCru ?? null,
        deteccoes,
      };
    }
    const resultados = [];
    for (const entrada of entradas) {
      const frames = [];
      if (entrada.video) {
        const video = document.createElement("video");
        video.muted = true;
        video.preload = "auto";
        video.crossOrigin = "anonymous";
        // Video fora da tela mas no DOM: sem isso o Chrome pode nao pintar o
        // novo quadro e drawImage devolve sempre o primeiro frame.
        video.style.cssText =
          "position:fixed;left:-10000px;top:0;width:2px;height:2px;opacity:0;pointer-events:none";
        document.body.appendChild(video);
        video.src = entrada.url;
        await new Promise((resolve, reject) => {
          video.onloadedmetadata = resolve;
          video.onerror = () => reject(new Error("nao foi possivel decodificar " + entrada.nome));
        });
        // Espera o quadro do seek ficar disponivel para composicao. O evento
        // seeked sozinho nao garante que drawImage ja veja o novo frame.
        const aguardarQuadro = async () => {
          if (typeof video.requestVideoFrameCallback === "function") {
            await new Promise((resolve) => {
              let resolvido = false;
              const concluir = () => {
                if (resolvido) return;
                resolvido = true;
                resolve();
              };
              video.requestVideoFrameCallback(concluir);
              setTimeout(concluir, 500);
            });
          } else {
            await new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve))
            );
          }
        };
        const quantidade = Math.min(amostras, Math.max(1, Math.floor(video.duration)));
        for (let i = 0; i < quantidade; i += 1) {
          const emSegundos = (video.duration * (i + 1)) / (quantidade + 1);
          await new Promise((resolve, reject) => {
            const aoBuscar = () => {
              video.removeEventListener("seeked", aoBuscar);
              resolve();
            };
            video.addEventListener("seeked", aoBuscar, { once: true });
            video.onerror = () => reject(new Error("falha ao buscar quadro de " + entrada.nome));
            video.currentTime = emSegundos;
          });
          await aguardarQuadro();
          frames.push(await inferir(video, video.videoWidth, video.videoHeight, emSegundos));
        }
        video.remove();
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
      lado,
      resultados,
    };
  };
  window.__carregada = true;
</script>`;

/**
 * Interpreta um cabecalho `Range` para um arquivo de `tamanho` bytes.
 *
 * - `undefined`: sem cabecalho (resposta 200 completa);
 * - `null`: faixa invalida/insatisfazivel (resposta 416);
 * - `{ inicio, fim }`: faixa inclusiva valida (resposta 206).
 *
 * O Chrome precisa de Range para fazer seek em video; sem isso `currentTime`
 * nao avanca e a amostragem devolve sempre o primeiro frame.
 */
export function interpretarFaixaBytes(cabecalho, tamanho) {
  if (typeof cabecalho !== "string" || !cabecalho) return undefined;
  const casamento = /^bytes=(\d*)-(\d*)$/.exec(cabecalho.trim());
  if (!casamento) return null;
  const [, inicioTexto, fimTexto] = casamento;
  if (!inicioTexto && !fimTexto) return null;
  let inicio;
  let fim;
  if (!inicioTexto) {
    // `bytes=-N`: os ultimos N bytes.
    const sufixo = Number(fimTexto);
    if (!Number.isFinite(sufixo) || sufixo <= 0) return null;
    inicio = Math.max(0, tamanho - sufixo);
    fim = tamanho - 1;
  } else {
    inicio = Number(inicioTexto);
    fim = fimTexto ? Number(fimTexto) : tamanho - 1;
  }
  if (!Number.isFinite(inicio) || !Number.isFinite(fim)) return null;
  if (inicio < 0 || inicio >= tamanho || inicio > fim) return null;
  return { inicio, fim: Math.min(fim, tamanho - 1) };
}

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
      const tamanho = statSync(entrada).size;
      const faixa = interpretarFaixaBytes(req.headers.range, tamanho);
      if (faixa === null) {
        res.writeHead(416, { "content-range": `bytes */${tamanho}` });
        res.end();
        return;
      }
      if (faixa) {
        res.writeHead(206, {
          "content-type": obterMimeEntrada(entrada),
          "content-length": faixa.fim - faixa.inicio + 1,
          "content-range": `bytes ${faixa.inicio}-${faixa.fim}/${tamanho}`,
          "accept-ranges": "bytes",
        });
        createReadStream(entrada, { start: faixa.inicio, end: faixa.fim }).pipe(res);
        return;
      }
      res.writeHead(200, {
        "content-type": obterMimeEntrada(entrada),
        "content-length": tamanho,
        "accept-ranges": "bytes",
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
      "Uso: node scripts/verificar-yolo-nsfw.mjs [modelo] [imagem|video ...] [limiar] [--amostras N] [--fixtures-nsfw] [--detalhado]"
    );
    console.log(
      "  --detalhado/-v  imprime rotulo, score e caixa de cada marcacao (comparacao entre modelos)"
    );
    return;
  }
  const chave = path.basename(config.modelo).replace(/\.onnx$/i, "");
  if (!/^[\w.-]+$/i.test(chave)) throw new Error("nome de modelo invalido");
  const lado = ladoDoModelo(chave);
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
      ([rotulos, limiar, arquivos, amostras, lado]) =>
        window.__iniciar(
          rotulos,
          limiar,
          arquivos.map((arquivo, indice) => ({
            nome: arquivo.nome,
            url: `/entrada/${indice}`,
            video: arquivo.video,
          })),
          amostras,
          lado
        ),
      [
        rotulos,
        config.limiar,
        entradas.map((arquivo) => ({
          nome: path.relative(ROOT, arquivo),
          video: EXTENSOES_VIDEO.has(path.extname(arquivo).toLowerCase()),
        })),
        config.amostras,
        lado,
      ]
    );

    if (errosDePagina.length) {
      console.error("Erros na pagina:", errosDePagina.join(" | "));
      process.exit(1);
    }

    console.log(`Modelo: ${chave}.onnx | entrada: ${lado}x${lado} | classes: ${rotulos.join(", ")}`);
    console.log(`Carga: ${r.msCarga} ms | limiar global: ${config.limiar} | execucao: WASM`);
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
      if (config.detalhado) {
        entrada.frames.forEach((frame, indice) => {
          const quando =
            frame.emSegundos === null ? "imagem" : `t=${frame.emSegundos.toFixed(2)}s`;
          console.log(
            `  quadro ${indice + 1} (${quando}, ${frame.largura}x${frame.altura}, ${frame.msInferencia} ms, assinatura ${frame.assinatura}, dims ${frame.dims.join("x")}):`
          );
          if (frame.debug) {
            console.log(
              `    debug: linhas=${frame.debug.linhas} linhasSigmoid=${frame.debug.linhasSigmoid} scoreMin=${frame.debug.minScore} scoreMax=${frame.debug.maxScore}`
            );
          }
          if (frame.deteccoes.length === 0) {
            console.log("    nenhuma");
            return;
          }
          for (const d of frame.deteccoes) {
            console.log(
              `    ${d.label} ${d.score.toFixed(4)} [${d.xmin.toFixed(1)},${d.ymin.toFixed(1)},${d.xmax.toFixed(1)},${d.ymax.toFixed(1)}]`
            );
          }
        });
      }
    }

    const formaInvalida = quadros.find((frame) => {
      const dims = frame.dims;
      if (dims.length < 2) return true;
      const ultima = dims[dims.length - 1];
      const crua = dims[1] === 22 || ultima === 22;
      // Saida crua: [1,22,N] ou [1,N,22]. Saida com NMS: [1,300,6].
      return crua ? false : ultima !== 6;
    });
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
