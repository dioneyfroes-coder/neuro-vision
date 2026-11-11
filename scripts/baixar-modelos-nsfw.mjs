#!/usr/bin/env node

/**
 * Baixa os modelos NSFW locais para `modelos/yolonsfw/` (gitignored).
 *
 * Diferente de `scripts/preparar-offline.mjs` (que cobre COCO/pose/maos), este
 * script e especifico do subsistema NSFW experimental:
 *
 *   - NudeNet 320n ONNX (saida crua YOLOv8 `[1, 22, N]`);
 *   - modulo NMS YOLOv8 (opcional; o cliente tambem implementa NMS em JS);
 *   - NudeNet 640m `.pt` (o export para ONNX roda depois, com
 *     `scripts/exportar-yolo-nsfw.mjs`);
 *   - detector dedicado de penis YOLOv8m `.pt` (idem: exportar depois).
 *
 * Os arquivos sao servidos pelo proprio servidor em `/yolonsfw/`. A pasta e
 * gitignored: nenhum peso entra no repositorio.
 *
 * Uso:
 *   node scripts/baixar-modelos-nsfw.mjs
 *   node scripts/baixar-modelos-nsfw.mjs --forcar
 *   node scripts/baixar-modelos-nsfw.mjs --listar
 */

import { createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import { rm, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DESTINO = path.join(ROOT, "modelos", "yolonsfw");

/** Classes do NudeNet v3.4 na ordem dos ids do modelo. */
export const CLASSES_NUDENET = [
  "FEMALE_GENITALIA_COVERED",
  "FACE_FEMALE",
  "BUTTOCKS_EXPOSED",
  "FEMALE_BREAST_EXPOSED",
  "FEMALE_GENITALIA_EXPOSED",
  "MALE_BREAST_EXPOSED",
  "ANUS_EXPOSED",
  "FEET_EXPOSED",
  "BELLY_COVERED",
  "FEET_COVERED",
  "ARMPITS_COVERED",
  "ARMPITS_EXPOSED",
  "FACE_MALE",
  "BELLY_EXPOSED",
  "MALE_GENITALIA_EXPOSED",
  "ANUS_COVERED",
  "FEMALE_BREAST_COVERED",
  "BUTTOCKS_COVERED",
];

/**
 * `tamanho` e o Content-Length esperado. A checagem e feita quando o servidor
 * informa o valor; se o CDN comprimir a resposta, o download e aceito mas o
 * tamanho e apenas registrado.
 */
export const MODELOS = [
  {
    nome: "NudeNet 320n (ONNX, saida crua)",
    origem: "https://huggingface.co/deepghs/nudenet_onnx/resolve/main/320n.onnx",
    arquivo: "nudenet_320n.onnx",
    tamanho: 12_150_158,
    sidecar: CLASSES_NUDENET,
  },
  {
    nome: "NudeNet NMS YOLOv8 (ONNX)",
    origem: "https://huggingface.co/deepghs/nudenet_onnx/resolve/main/nms-yolov8.onnx",
    arquivo: "nms-yolov8.onnx",
    tamanho: 3_096,
  },
  {
    nome: "NudeNet 640m (.pt, exportar depois)",
    origem: "https://huggingface.co/vladmandic/nudenet/resolve/main/nudenet-v34-640m.pt",
    arquivo: "nudenet_640m.pt",
    tamanho: 52_023_681,
  },
  {
    nome: "Detector de penis YOLOv8m (.pt, exportar depois)",
    origem:
      "https://huggingface.co/throaway2854/YOLOv8m-Penis-Detection/resolve/main/best.pt?download=true",
    arquivo: "penis_yolov8m.pt",
    tamanho: 52_073_042,
  },
];

function formatarBytes(bytes) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} kB`;
  return `${bytes} B`;
}

function lerArgs() {
  const lista = process.argv.slice(2);
  return {
    forcar: lista.includes("--forcar"),
    listar: lista.includes("--listar") || lista.includes("-l"),
    ajuda: lista.includes("--help") || lista.includes("-h"),
  };
}

async function baixar(item, { forcar }) {
  const alvo = path.join(DESTINO, item.arquivo);
  if (existsSync(alvo) && !forcar) {
    const bytes = statSync(alvo).size;
    console.log(`  ok      ${item.arquivo} (${formatarBytes(bytes)}, ja existe)`);
    await gravarSidecar(item, alvo);
    return { pulado: true, bytes };
  }

  mkdirSync(DESTINO, { recursive: true });
  const parcial = `${alvo}.parcial`;
  let resposta;
  try {
    resposta = await fetch(item.origem, { redirect: "follow" });
  } catch (err) {
    throw new Error(`falha de rede em ${item.origem}: ${err.message}`, { cause: err });
  }
  if (!resposta.ok || !resposta.body) {
    throw new Error(`HTTP ${resposta.status} em ${item.origem}`);
  }

  const esperado = Number(resposta.headers.get("content-length")) || item.tamanho || 0;
  const comprimido = Boolean(resposta.headers.get("content-encoding"));
  try {
    await pipeline(Readable.fromWeb(resposta.body), createWriteStream(parcial));
  } catch (err) {
    await rm(parcial, { force: true });
    throw new Error(`falha ao gravar ${item.arquivo}: ${err.message}`, { cause: err });
  }

  const baixado = statSync(parcial).size;
  if (esperado && !comprimido && baixado !== esperado) {
    await rm(parcial, { force: true });
    throw new Error(
      `tamanho divergente em ${item.arquivo}: esperado ${esperado}, obtido ${baixado}`
    );
  }
  if (baixado === 0) {
    await rm(parcial, { force: true });
    throw new Error(`arquivo vazio em ${item.origem}`);
  }

  await rename(parcial, alvo);
  await gravarSidecar(item, alvo);
  console.log(`  baixado ${item.arquivo} (${formatarBytes(baixado)})`);
  return { pulado: false, bytes: baixado };
}

/**
 * Grava `<modelo>.onnx.json` com os nomes de classe. O cliente le esse sidecar
 * e nao depende de tabela duplicada no codigo.
 */
async function gravarSidecar(item, alvo) {
  if (!item.sidecar || !item.arquivo.endsWith(".onnx")) return;
  const sidecar = `${alvo}.json`;
  const conteudo = {
    modelo: item.arquivo.replace(/\.onnx$/, ""),
    origem: item.origem,
    classes: item.sidecar,
  };
  await writeFile(sidecar, `${JSON.stringify(conteudo, null, 2)}\n`, "utf8");
}

function listar() {
  console.log(`Destino: ${path.relative(ROOT, DESTINO).replace(/\\/g, "/")}/\n`);
  for (const item of MODELOS) {
    console.log(`  ${item.arquivo}  (${formatarBytes(item.tamanho)})`);
    console.log(`    ${item.origem}`);
  }
}

function ajuda() {
  console.log("Uso: node scripts/baixar-modelos-nsfw.mjs [--forcar] [--listar]");
  console.log("");
  console.log("Baixa NudeNet 320n, NMS YOLOv8, NudeNet 640m e o detector de penis YOLOv8m para modelos/yolonsfw/.");
  console.log("Depois de baixar os .pt, exporte com:");
  console.log("  node scripts/exportar-yolo-nsfw.mjs modelos/yolonsfw/nudenet_640m.pt");
  console.log("  node scripts/exportar-yolo-nsfw.mjs modelos/yolonsfw/penis_yolov8m.pt");
}

async function main() {
  const opcoes = lerArgs();
  if (opcoes.ajuda) return ajuda();
  if (opcoes.listar) return listar();

  console.log(`Baixando modelos NSFW para ${path.relative(ROOT, DESTINO) || "."}/`);
  let novos = 0;
  let pulados = 0;
  let bytes = 0;
  const falhas = [];
  for (const item of MODELOS) {
    console.log(`\n${item.nome}:`);
    try {
      const r = await baixar(item, opcoes);
      if (r.pulado) pulados += 1;
      else {
        novos += 1;
        bytes += r.bytes;
      }
    } catch (err) {
      console.error(`  FALHA   ${item.arquivo}: ${err.message}`);
      falhas.push({ arquivo: item.arquivo, erro: err.message });
    }
  }

  console.log(
    `\nResumo: ${novos} baixado(s), ${pulados} ja presente(s), ${formatarBytes(bytes)}.`
  );
  if (falhas.length) {
    console.error(`${falhas.length} falha(s):`);
    for (const f of falhas) console.error(`  - ${f.arquivo}: ${f.erro}`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`Erro inesperado: ${err.message}`);
    process.exit(1);
  });
}
