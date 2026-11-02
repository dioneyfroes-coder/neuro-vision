#!/usr/bin/env node

/**
 * Extrai quadros de um clipe `.mp4` ou `.webm` para JPEGs, para conferir o
 * conteudo e anotar os eventos esperados. Usa o Chromium do Playwright.
 *
 * Uso:
 *   node scripts/extrair-frames.mjs <clipe.mp4|webm> <dir-saida> [tempos-segundos]
 *
 * Exemplo:
 *   node scripts/extrair-frames.mjs bench/videos/webcam.mp4 bench/videos/frames 0.3,1.5,3
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function tipoMimeVideo(caminho) {
  const extensao = path.extname(caminho).toLowerCase();
  const tipos = {
    ".mp4": "video/mp4",
    ".webm": "video/webm",
  };
  const tipo = tipos[extensao];
  if (!tipo) throw new Error(`formato de video nao suportado: ${extensao || "(sem extensao)"}`);
  return tipo;
}

async function main() {
  const [clip, dirSaida = "bench/videos/frames", temposArg = "0.3,1.5,3.0,4.5"] = process.argv.slice(2);
  if (!clip) {
    console.error("Uso: node scripts/extrair-frames.mjs <clipe.mp4|webm> [dir-saida] [tempos-segundos]");
    process.exit(1);
  }
  const tempos = temposArg.split(",").map(Number).filter((n) => Number.isFinite(n));

  const bytes = await readFile(path.resolve(ROOT, clip));
  const dataUrl = `data:${tipoMimeVideo(clip)};base64,${bytes.toString("base64")}`;

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent("<video id=v muted playsinline></video>");
    const destino = path.resolve(ROOT, dirSaida);
    await mkdir(destino, { recursive: true });

    for (const t of tempos) {
      const b64 = await page.evaluate(
        async ({ dataUrl, t }) => {
          const v = document.getElementById("v");
          if (v.src !== dataUrl) {
            await new Promise((resolve, reject) => {
              v.onloadeddata = resolve;
              v.onerror = () =>
                reject(
                  new Error(
                    `nao foi possivel decodificar o clipe: ${v.error?.message ?? "erro de midia"}`
                  )
                );
              v.src = dataUrl;
            });
          }
          await new Promise((resolve, reject) => {
            v.onseeked = resolve;
            v.onerror = () =>
              reject(
                new Error(
                  `falha ao buscar quadro em ${t}s: ${v.error?.message ?? "erro de midia"}`
                )
              );
            v.currentTime = Math.min(t, Math.max(0, (v.duration || t) - 0.05));
          });
          const c = document.createElement("canvas");
          c.width = v.videoWidth || 640;
          c.height = v.videoHeight || 480;
          c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
          return c.toDataURL("image/jpeg", 0.8);
        },
        { dataUrl, t }
      );
      const arquivo = path.join(destino, `frame-${t}.jpg`);
      await writeFile(arquivo, Buffer.from(b64.split(",")[1], "base64"));
      console.log(`Salvo: ${arquivo}`);
    }
  } finally {
    await browser.close();
  }
}

const executadoDiretamente =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (executadoDiretamente) {
  main().catch((err) => {
    console.error(`ERRO: ${err.message}`);
    process.exit(1);
  });
}

export { main as extrairFrames };
