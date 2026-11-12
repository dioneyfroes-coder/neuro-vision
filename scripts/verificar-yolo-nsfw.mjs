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
    conjunto: false,
    isolamento: true,
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
    } else if (argumento === "--conjunto") {
      config.conjunto = true;
    } else if (argumento === "--sem-isolamento") {
      config.isolamento = false;
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

  function saidaCruaUsaLogits(cru, linhas, indice, quantidadeClasses) {
    for (let i = 0; i < linhas; i++) {
      for (let c = 0; c < quantidadeClasses; c++) {
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

  // Saida crua YOLOv8: [1, 4+nc, N] ou [1, N, 4+nc]. O numero de classes vem
  // do sidecar (NudeNet: 18; penis: 1), sem hardcode.
  function interpretarCru(cru, dims, limiar, largura, altura, rotulos, lado) {
    const quantidadeClasses = rotulos.length;
    const colunas = 4 + quantidadeClasses;
    const transposto = dims[1] === colunas;
    const linhas = transposto ? dims[dims.length - 1] : dims[dims.length - 2];
    const indice = (linha, coluna) =>
      transposto ? coluna * linhas + linha : linha * colunas + coluna;
    const ex = largura / lado;
    const ey = altura / lado;
    const candidatas = [];
    let minScore = Infinity;
    let maxScore = -Infinity;
    let linhasSigmoid = 0;
    const usaLogits = saidaCruaUsaLogits(cru, linhas, indice, quantidadeClasses);
    for (let i = 0; i < linhas; i++) {
      const scores = new Array(quantidadeClasses);
      for (let c = 0; c < quantidadeClasses; c++) {
        const valor = cru[indice(i, 4 + c)];
        scores[c] = usaLogits ? sigmoid(valor) : valor;
        if (valor < minScore) minScore = valor;
        if (valor > maxScore) maxScore = valor;
      }
      if (usaLogits) linhasSigmoid += 1;
      let melhor = 0;
      let score = scores[0];
      for (let c = 1; c < quantidadeClasses; c++) {
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
    // Saida com NMS embutido tem exatamente 6 colunas (xyxy, score, classe).
    // Qualquer outra forma e saida crua (4 coords + nc scores).
    const nms = dims[1] === 6 || ultima === 6;
    return nms
      ? interpretarNms(cru, dims, limiar, largura, altura, rotulos, lado)
      : interpretarCru(cru, dims, limiar, largura, altura, rotulos, lado);
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

  // Memoria linear WASM: o ORT aloca WebAssembly.Memory para pesos e ativacoes,
  // e o heap JS nao ve essa memoria. Envolver o construtor mede o custo real do
  // modelo sem depender de APIs de medicao do navegador.
  const memoriasWasm = [];
  if (typeof WebAssembly !== "undefined" && typeof WebAssembly.Memory === "function") {
    const MemoriaOriginal = WebAssembly.Memory;
    WebAssembly.Memory = new Proxy(MemoriaOriginal, {
      construct(alvo, argumentos) {
        const memoria = Reflect.construct(alvo, argumentos);
        memoriasWasm.push(memoria);
        return memoria;
      },
    });
  }

  function bytesMemoriaWasm() {
    let total = 0;
    for (const memoria of memoriasWasm) total += memoria.buffer.byteLength;
    return total;
  }

  // Memoria: o heap JS (performance.memory) e grosseiro e nao inclui o WASM;
  // somamos a memoria linear das instancias criadas pelo ORT. Quando
  // measureUserAgentSpecificMemory existe (raro em headless), ele e preferido.
  async function medirMemoria() {
    const amostra = {
      metodo: null,
      totalBytes: null,
      jsHeapBytes: null,
      wasmBytes: bytesMemoriaWasm(),
    };
    if (performance.memory && Number.isFinite(performance.memory.usedJSHeapSize)) {
      amostra.jsHeapBytes = performance.memory.usedJSHeapSize;
    }
    if (typeof performance.measureUserAgentSpecificMemory === "function") {
      try {
        const medida = await performance.measureUserAgentSpecificMemory();
        if (medida && Number.isFinite(medida.bytes)) {
          amostra.totalBytes = medida.bytes;
          amostra.metodo = "measureUserAgentSpecificMemory";
        }
      } catch {
        // Sem isolamento/credencial: cai para WASM + heap JS.
      }
    }
    if (!amostra.metodo) {
      if (amostra.wasmBytes > 0 && amostra.jsHeapBytes !== null) {
        amostra.metodo = "wasm+performance.memory";
      } else if (amostra.wasmBytes > 0) {
        amostra.metodo = "wasm";
      } else if (amostra.jsHeapBytes !== null) {
        amostra.metodo = "performance.memory";
      }
    }
    return amostra;
  }

  window.__iniciar = async (rotulos, limiar, entradas, amostras, lado) => {    const canvas = typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(lado, lado)
      : Object.assign(document.createElement("canvas"), { width: lado, height: lado });
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    // Mesma politica de public/desempenho.ts: sem isolamento o WASM cai para
    // 1 thread; com COOP/COEP usa ate 4 threads por runtime.
    const isolado = typeof crossOriginIsolated !== "undefined" && crossOriginIsolated;
    const nucleos = Number.isFinite(navigator.hardwareConcurrency)
      ? navigator.hardwareConcurrency
      : 1;
    const threads = isolado ? Math.max(1, Math.min(4, nucleos)) : 1;
    ort.env.wasm.numThreads = threads;
    const ambiente = {
      crossOriginIsolated: isolado,
      hardwareConcurrency: nucleos,
      numThreads: threads,
      simd: ort.env.wasm.simd ?? null,
    };
    const memoriaAntes = await medirMemoria();
    let picoJsHeapBytes = memoriaAntes.jsHeapBytes;

    const inicioCarga = performance.now();
    const sessao = await ort.InferenceSession.create("/modelo.onnx", {
      executionProviders: ["wasm"],
    });
    const msCarga = Math.round(performance.now() - inicioCarga);
    const memoriaCarga = await medirMemoria();
    if (
      memoriaCarga.jsHeapBytes !== null &&
      (picoJsHeapBytes === null || memoriaCarga.jsHeapBytes > picoJsHeapBytes)
    ) {
      picoJsHeapBytes = memoriaCarga.jsHeapBytes;
    }
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
      if (
        performance.memory &&
        Number.isFinite(performance.memory.usedJSHeapSize) &&
        (picoJsHeapBytes === null || performance.memory.usedJSHeapSize > picoJsHeapBytes)
      ) {
        picoJsHeapBytes = performance.memory.usedJSHeapSize;
      }
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
    const memoriaAposInferencia = await medirMemoria();
    if (
      memoriaAposInferencia.jsHeapBytes !== null &&
      (picoJsHeapBytes === null || memoriaAposInferencia.jsHeapBytes > picoJsHeapBytes)
    ) {
      picoJsHeapBytes = memoriaAposInferencia.jsHeapBytes;
    }
    return {
      msCarga,
      lado,
      resultados,
      ambiente,
      memoria: {
        antes: memoriaAntes,
        aposCarga: memoriaCarga,
        aposInferencia: memoriaAposInferencia,
        picoJsHeapBytes,
      },
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

async function servir(porta, modelo, entradas, isolamento = true) {
  const html = Buffer.from(PAGINA, "utf8");
  const pesos = await readFile(modelo);
  // COOP/COEP habilitam SharedArrayBuffer e o WASM multithread do ORT, igual ao
  // servidor do app. `--sem-isolamento` desliga para medir o efeito (1 thread).
  const cabecalhosIsolamento = isolamento
    ? {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "credentialless",
      }
    : {};
  const servidor = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/") {
      res.writeHead(200, { ...cabecalhosIsolamento, "content-type": MIME[".html"] });
      res.end(html);
      return;
    }
    if (url.pathname === "/modelo.onnx") {
      res.writeHead(200, {
        ...cabecalhosIsolamento,
        "content-type": MIME[".onnx"],
        "content-length": pesos.length,
      });
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
        res.writeHead(416, {
          ...cabecalhosIsolamento,
          "content-range": `bytes */${tamanho}`,
        });
        res.end();
        return;
      }
      if (faixa) {
        res.writeHead(206, {
          ...cabecalhosIsolamento,
          "content-type": obterMimeEntrada(entrada),
          "content-length": faixa.fim - faixa.inicio + 1,
          "content-range": `bytes ${faixa.inicio}-${faixa.fim}/${tamanho}`,
          "accept-ranges": "bytes",
        });
        createReadStream(entrada, { start: faixa.inicio, end: faixa.fim }).pipe(res);
        return;
      }
      res.writeHead(200, {
        ...cabecalhosIsolamento,
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
        ...cabecalhosIsolamento,
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

/** Modelos do conjunto NSFW, na mesma ordem de `public/nsfw-onnx.ts`. */
const MODELOS_CONJUNTO = [
  "nudenet_320n",
  "nudenet_640m",
  "erax_nsfw_yolo11n",
  "erax_nsfw_yolo11s",
  "erax_nsfw_yolo11m",
  "penis_yolov8m",
];

/** Formata bytes em MB com uma casa; `n/d` quando a metrica nao existe. */
function formatarBytes(bytes) {
  if (!Number.isFinite(bytes)) return "n/d";
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Valor efetivo de uma amostra, preferindo o total do agente ao WASM/heap JS. */
function memoriaDaAmostra(amostra) {
  if (!amostra) return null;
  if (Number.isFinite(amostra.totalBytes)) return amostra.totalBytes;
  if (Number.isFinite(amostra.wasmBytes) && amostra.wasmBytes > 0) return amostra.wasmBytes;
  if (Number.isFinite(amostra.jsHeapBytes)) return amostra.jsHeapBytes;
  return null;
}

async function carregarRotulosModelo(chave) {
  const modelo = path.join(DIR_PESOS, `${chave}.onnx`);
  const sidecar = `${modelo}.json`;
  if (!existsSync(modelo)) {
    throw new Error(`modelo nao encontrado: ${path.relative(ROOT, modelo)} (exporte com scripts/exportar-yolo-nsfw.mjs)`);
  }
  if (!existsSync(sidecar)) {
    throw new Error(`sidecar de classes ausente: ${path.relative(ROOT, sidecar)} (reexporte o modelo)`);
  }
  const rotulos = JSON.parse(await readFile(sidecar, "utf8")).classes;
  if (!Array.isArray(rotulos) || rotulos.length === 0) {
    throw new Error("sidecar sem classes validas");
  }
  return { modelo, rotulos, lado: ladoDoModelo(chave) };
}

/**
 * Executa um modelo sobre as entradas e devolve um resumo para o benchmark do
 * conjunto. Lanca em qualquer falha de forma/rotulo/caixa.
 */
async function verificarModelo(chave, config, entradas) {
  const { modelo, rotulos, lado } = await carregarRotulosModelo(chave);
  const servidor = await servir(0, modelo, entradas, config.isolamento);
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
      throw new Error(`erros na pagina: ${errosDePagina.join(" | ")}`);
    }

    console.log(`Modelo: ${chave}.onnx | entrada: ${lado}x${lado} | classes: ${rotulos.join(", ")}`);
    console.log(`Carga: ${r.msCarga} ms | limiar global: ${config.limiar} | execucao: WASM`);
    console.log(
      `Ambiente: crossOriginIsolated=${r.ambiente.crossOriginIsolated} | ` +
        `hardwareConcurrency=${r.ambiente.hardwareConcurrency} | numThreads=${r.ambiente.numThreads} | simd=${r.ambiente.simd}`
    );
    const memoriaAntes = memoriaDaAmostra(r.memoria.antes);
    const memoriaCarga = memoriaDaAmostra(r.memoria.aposCarga);
    const memoriaInferencia = memoriaDaAmostra(r.memoria.aposInferencia);
    const metodoMemoria = r.memoria.aposInferencia.metodo ?? "indisponivel";
    const wasmAntes = r.memoria.antes.wasmBytes ?? 0;
    const wasmCarga = r.memoria.aposCarga.wasmBytes ?? 0;
    const wasmInferencia = r.memoria.aposInferencia.wasmBytes ?? 0;
    console.log(
      `Memoria (${metodoMemoria}): wasm antes ${formatarBytes(wasmAntes)} | ` +
        `apos carga ${formatarBytes(wasmCarga)} (+${formatarBytes(wasmCarga - wasmAntes)}) | ` +
        `apos inferencia ${formatarBytes(wasmInferencia)} (+${formatarBytes(wasmInferencia - wasmAntes)}) | ` +
        `pico JS heap ${formatarBytes(r.memoria.picoJsHeapBytes)}`
    );
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
      const nms = dims[1] === 6 || ultima === 6;
      // Saida com NMS: [1,300,6] (ou [1,6,300]). Saida crua: 4 + nc colunas.
      if (nms) return ultima !== 6 && dims[1] !== 6;
      const colunas = 4 + rotulos.length;
      return dims[1] !== colunas && ultima !== colunas;
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
      throw new Error(`saida com forma inesperada (${formaInvalida.dims.join("x")})`);
    }
    if (fora) throw new Error("caixa fora dos limites do frame");
    if (rotuloDesconhecido) throw new Error("rotulo desconhecido (sidecar ausente/divergente)");
    console.log("OK: saida valida, caixas dentro dos limites e rotulos do sidecar.");

    const totalMarcacoes = quadros.reduce((soma, frame) => soma + frame.deteccoes.length, 0);
    const msInferenciaMedia = quadros.length
      ? Math.round(
          quadros.reduce((soma, frame) => soma + frame.msInferencia, 0) / quadros.length
        )
      : 0;
    return {
      chave,
      msCarga: r.msCarga,
      msInferenciaMedia,
      quadros: quadros.length,
      marcacoes: totalMarcacoes,
      memoriaAntesBytes: memoriaAntes,
      memoriaCargaBytes: memoriaCarga,
      memoriaInferenciaBytes: memoriaInferencia,
      picoJsHeapBytes: r.memoria.picoJsHeapBytes,
      memoriaMetodo: metodoMemoria,
      crossOriginIsolated: r.ambiente.crossOriginIsolated,
      numThreads: r.ambiente.numThreads,
    };
  } finally {
    await navegador.close();
    servidor.close();
  }
}

async function main() {
  const config = parsearArgumentos(process.argv.slice(2));
  if (config.ajuda) {
    console.log(
      "Uso: node scripts/verificar-yolo-nsfw.mjs [modelo] [imagem|video ...] [limiar] [--amostras N] [--fixtures-nsfw] [--detalhado] [--conjunto]"
    );
    console.log(
      "  --detalhado/-v  imprime rotulo, score e caixa de cada marcacao (comparacao entre modelos)"
    );
    console.log(
      "  --conjunto      roda todos os modelos do conjunto NSFW e imprime um resumo comparativo"
    );
    console.log(
      "  --sem-isolamento desliga COOP/COEP (WASM em 1 thread) para medir o efeito do isolamento"
    );
    return;
  }
  // Em `--conjunto` o primeiro argumento pode ser o clipe (sem modelo): se ele
  // tem extensao de arquivo, entra como entrada em vez de nome de modelo.
  const modeloComoEntrada =
    config.conjunto && /\.[a-z0-9]+$/i.test(config.modelo) ? [config.modelo] : [];
  const entradasArg = config.fixturesNsfw
    ? [...modeloComoEntrada, ...config.entradas, ...(await descobrirFixturesNsfw())]
    : modeloComoEntrada.length || config.entradas.length
      ? [...modeloComoEntrada, ...config.entradas]
      : ["bench/videos/frames/frame-1.jpg"];
  if (!entradasArg.length) throw new Error("nenhuma fixture NSFW encontrada");
  const entradas = entradasArg.map((arquivo) => path.resolve(ROOT, arquivo));
  for (const [indice, entrada] of entradas.entries()) {
    if (!existsSync(entrada)) throw new Error(`arquivo nao encontrado: ${entradasArg[indice]}`);
    if (!obterMimeEntrada(entrada)) throw new Error(`formato nao suportado: ${entradasArg[indice]}`);
  }

  if (config.conjunto) {
    const resumos = [];
    const falhas = [];
    for (const chave of MODELOS_CONJUNTO) {
      console.log(`\n=== ${chave} ===`);
      try {
        resumos.push(await verificarModelo(chave, config, entradas));
      } catch (erro) {
        console.error(`FALHA ${chave}: ${erro.message}`);
        falhas.push({ chave, erro: erro.message });
      }
    }
    console.log("\n=== Resumo do conjunto ===");
    for (const resumo of resumos) {
      console.log(
        `${resumo.chave}: carga ${resumo.msCarga} ms | inferencia media ${resumo.msInferenciaMedia} ms/quadro | ` +
          `${resumo.marcacoes} marcacao(oes) em ${resumo.quadros} quadro(s) | ` +
          `memoria ${formatarBytes(resumo.memoriaInferenciaBytes)} (${resumo.memoriaMetodo}) | ` +
          `threads ${resumo.numThreads}`
      );
    }
    if (falhas.length) {
      console.error(`\n${falhas.length} modelo(s) falharam.`);
      process.exit(1);
    }
    return;
  }

  const chave = path.basename(config.modelo).replace(/\.onnx$/i, "");
  if (!/^[\w.-]+$/i.test(chave)) throw new Error("nome de modelo invalido");
  await verificarModelo(chave, config, entradas);
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
