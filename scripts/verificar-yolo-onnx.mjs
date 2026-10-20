#!/usr/bin/env node

/**
 * Verificacao empirica do detector YOLO ONNX (Etapa 11).
 *
 * Baixa o `model.onnx` do Hugging Face (cache local), roda a inferencia real
 * em WASM **no Chromium** (mesmo runtime/caminho de producao) sobre um frame
 * extraido dos clipes de avaliacao e imprime as deteccoes. O pre-pos-
 * processamento do cliente espelha `public/yolo-onnx.ts`:
 *   stretch 640x640 -> /255 RGB NCHW -> saida [1, 300, 6] -> caixas na
 *   resolucao original. Os rotulos vem do proprio modulo de producao
 *   (`COCO_INGLES`), extraidos do fonte — sem duplicar a tabela.
 *
 * Sai com codigo 1 se nenhum `person` com confianca >= 0.6 for detectado (a
 * anotacao do clipe `webcam-mudanca` garante pessoa no quadro em 1 s e 3 s)
 * ou se alguma caixa sair dos limites do frame.
 *
 * Uso: node scripts/verificar-yolo-onnx.mjs [frame.jpg] [limiar]
 */

import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST_ORT = path.join(ROOT, "node_modules", "onnxruntime-web", "dist");
const MODELO_URL =
  "https://huggingface.co/onnx-community/yolov10n/resolve/main/onnx/model.onnx";
const CACHE_MODELO = path.join(ROOT, "node_modules", ".cache", "neuro", "yolov10n.onnx");

const MIME = {
  ".mjs": "application/javascript",
  ".js": "application/javascript",
  ".wasm": "application/wasm",
  ".onnx": "application/octet-stream",
  ".jpg": "image/jpeg",
  ".html": "text/html; charset=utf-8",
};

/** Le `COCO_INGLES` do modulo de producao (fonte unico da tabela). */
async function lerRotulos() {
  const fonte = await readFile(path.join(ROOT, "public", "yolo-onnx.ts"), "utf8");
  const bloco = fonte.match(/export const COCO_INGLES = \[([\s\S]*?)\];/);
  if (!bloco) throw new Error("COCO_INGLES nao encontrado em public/yolo-onnx.ts");
  const rotulos = [...bloco[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  if (rotulos.length !== 80) {
    throw new Error(`Esperados 80 rotulos COCO, obtidos ${rotulos.length}`);
  }
  return rotulos;
}

/** Baixa o modelo uma vez e reutiliza o cache local. */
async function garantirModelo() {
  if (existsSync(CACHE_MODELO)) return;
  await mkdir(path.dirname(CACHE_MODELO), { recursive: true });
  console.log(`Baixando modelo: ${MODELO_URL}`);
  const resposta = await fetch(MODELO_URL, { redirect: "follow" });
  if (!resposta.ok) throw new Error(`Download falhou: HTTP ${resposta.status}`);
  const bytes = Buffer.from(await resposta.arrayBuffer());
  await writeFile(CACHE_MODELO, bytes);
  console.log(`Modelo salvo em cache: ${(bytes.length / 1e6).toFixed(1)} MB`);
}

/**
 * Pagina que espelha o pre-pos-processamento de `public/yolo-onnx.ts`.
 * Sem template literals dentro do cliente (o HTML e montado com crase).
 */
const PAGINA = `<!doctype html>
<meta charset="utf-8">
<title>verificar-yolo-onnx</title>
<script type="module">
  import * as ort from "/ort/ort.min.mjs";
  ort.env.wasm.wasmPaths = "/ort/";
  // Threads no padrao do runtime (auto): mediu ~730 ms/inferencia em WASM,
  // igual a 1 thread — producao usa o mesmo comportamento padrao.

  const LADO = 640;

  // Espelho de rgbaParaTensorNCHW.
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

  // Espelho de interpretarSaidaYolo (forma [1, 300, 6]).
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

  window.__iniciar = async (rotulos, limiar) => {
    const img = new Image();
    img.src = "/frame.jpg";
    await img.decode();
    const largura = img.naturalWidth;
    const altura = img.naturalHeight;

    const canvas = typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(LADO, LADO)
      : Object.assign(document.createElement("canvas"), { width: LADO, height: LADO });
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, LADO, LADO);
    const dados = paraTensor(ctx.getImageData(0, 0, LADO, LADO).data);

    const t0 = performance.now();
    const sessao = await ort.InferenceSession.create("/modelo.onnx", {
      executionProviders: ["wasm"],
    });
    const msCarga = Math.round(performance.now() - t0);

    const t1 = performance.now();
    const feeds = {};
    feeds[sessao.inputNames[0]] = new ort.Tensor("float32", dados, [1, 3, LADO, LADO]);
    const resultado = await sessao.run(feeds);
    const msInferencia = Math.round(performance.now() - t1);

    const tensor = resultado[sessao.outputNames[0]];
    return {
      largura,
      altura,
      msCarga,
      msInferencia,
      dims: Array.from(tensor.dims),
      deteccoes: interpretar(tensor.data, tensor.dims, limiar, largura, altura, rotulos),
    };
  };
  window.__carregada = true;
</script>`;

/** Serve a pagina, o runtime ONNX, o modelo e o frame. */
async function servir(porta, frame) {
  const html = Buffer.from(PAGINA, "utf8");
  const modelo = await readFile(CACHE_MODELO);
  const jpg = await readFile(frame);
  const servidor = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/") {
      res.writeHead(200, { "content-type": MIME[".html"] });
      res.end(html);
      return;
    }
    if (url.pathname === "/modelo.onnx") {
      res.writeHead(200, { "content-type": MIME[".onnx"], "content-length": modelo.length });
      res.end(modelo);
      return;
    }
    if (url.pathname === "/frame.jpg") {
      res.writeHead(200, { "content-type": MIME[".jpg"], "content-length": jpg.length });
      res.end(jpg);
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
  const [frameArg = "bench/videos/frames/frame-1.jpg", limiarArg = "0.5"] = process.argv.slice(2);
  const frame = path.resolve(ROOT, frameArg);
  if (!existsSync(frame)) {
    console.error(`Frame nao encontrado: ${frameArg}`);
    console.error(
      "Gere com: node scripts/extrair-frames.mjs bench/videos/webcam-mudanca.webm bench/videos/frames 1.0,3.0"
    );
    process.exit(1);
  }

  const [rotulos] = await Promise.all([lerRotulos(), garantirModelo()]);
  const servidor = await servir(0, frame);
  const porta = servidor.address().port;
  const navegador = await chromium.launch();
  try {
    const pagina = await navegador.newPage();
    const errosDePagina = [];
    pagina.on("pageerror", (e) => errosDePagina.push(String(e)));
    await pagina.goto(`http://127.0.0.1:${porta}/`);
    await pagina.waitForFunction(() => window.__carregada === true, null, { timeout: 60_000 });
    const r = await pagina.evaluate(
      ([rotulos, limiar]) => window.__iniciar(rotulos, limiar),
      [rotulos, Number(limiarArg)]
    );

    if (errosDePagina.length) {
      console.error("Erros na pagina:", errosDePagina.join(" | "));
      process.exit(1);
    }

    console.log(`Frame: ${frameArg} (${r.largura}x${r.altura}) | saida dims=${r.dims.join("x")}`);
    console.log(`Carga: ${r.msCarga} ms | Inferencia: ${r.msInferencia} ms (WASM)`);
    console.log(`Deteccoes (limiar ${limiarArg}): ${r.deteccoes.length}`);
    for (const d of r.deteccoes) {
      const w = Math.round(d.xmax - d.xmin);
      const h = Math.round(d.ymax - d.ymin);
      console.log(
        `  ${d.label.padEnd(14)} ${d.score.toFixed(3)}  x=${d.xmin} y=${d.ymin} w=${w} h=${h}`
      );
    }

    const fora = r.deteccoes.some(
      (d) => d.xmin < 0 || d.ymin < 0 || d.xmax > r.largura || d.ymax > r.altura
    );
    const temPessoa = r.deteccoes.some((d) => d.label === "person" && d.score >= 0.6);
    if (fora) {
      console.error("FALHA: caixa fora dos limites do frame.");
      process.exit(1);
    }
    if (!temPessoa) {
      console.error("FALHA: nenhuma 'person' com confianca >= 0.6 (clipe anotado tem pessoa).");
      process.exit(1);
    }
    console.log("OK: caixas dentro dos limites e pessoa detectada.");
  } finally {
    await navegador.close();
    servidor.close();
  }
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
