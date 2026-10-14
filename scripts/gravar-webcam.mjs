#!/usr/bin/env node

/**
 * Grava alguns segundos da webcam real para um arquivo `.webm`, usando o
 * Chromium do Playwright + MediaRecorder. Serve para produzir os **clipes reais**
 * do conjunto de avaliação (Fase 7): depois de gravados, eles são reproduzidos
 * para o app por `e2e/webcam.spec.ts` (com o modelo real).
 *
 * Uso:
 *   node scripts/gravar-webcam.mjs [saida.webm] [segundos]
 *
 * Requer uma câmera acessível e abre uma janela (headed), porque a captura de
 * dispositivo real não funciona em modo headless.
 */

import { mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function gravar({ saida, segundos }) {
  // `navigator.mediaDevices` so existe em contexto seguro; `127.0.0.1` conta
  // como localhost, entao servimos uma pagina minima local para a captura.
  const servidor = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<!doctype html><meta charset=utf-8><title>gravador</title>");
  });
  await new Promise((resolve) => servidor.listen(0, "127.0.0.1", resolve));
  const porta = servidor.address().port;

  const browser = await chromium.launch({
    headless: false,
    args: ["--use-fake-ui-for-media-stream"],
  });
  try {
    const context = await browser.newContext({ permissions: ["camera"] });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${porta}/`);

    const b64 = await page.evaluate(async (duracaoSegundos) => {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
        audio: false,
      });
      const candidatos = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
      const tipo = candidatos.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
      const gravador = new MediaRecorder(stream, tipo ? { mimeType: tipo } : undefined);
      const partes = [];
      gravador.ondataavailable = (e) => {
        if (e.data.size) partes.push(e.data);
      };
      const parou = new Promise((resolve) => {
        gravador.onstop = resolve;
      });
      gravador.start();
      await new Promise((r) => setTimeout(r, duracaoSegundos * 1000));
      gravador.stop();
      await parou;
      stream.getTracks().forEach((t) => t.stop());

      const blob = new Blob(partes, { type: tipo || "video/webm" });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binario = "";
      const passo = 0x8000;
      for (let i = 0; i < bytes.length; i += passo) {
        binario += String.fromCharCode(...bytes.subarray(i, i + passo));
      }
      return btoa(binario);
    }, segundos);

    const destino = path.resolve(ROOT, saida);
    await mkdir(path.dirname(destino), { recursive: true });
    const bytes = Buffer.from(b64, "base64");
    await writeFile(destino, bytes);
    return { destino, tamanho: bytes.length };
  } finally {
    await browser.close();
    await new Promise((resolve) => servidor.close(resolve));
  }
}

async function main() {
  const args = process.argv.slice(2);
  const saida = args[0] ?? `bench/videos/webcam-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.webm`;
  const segundos = Math.max(1, Number(args[1]) || 5);
  console.log(`Gravando ${segundos}s da webcam para ${saida} ...`);
  const { destino, tamanho } = await gravar({ saida, segundos });
  console.log(`Salvo: ${destino} (${(tamanho / 1024).toFixed(0)} KB)`);
}

const executadoDiretamente =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (executadoDiretamente) {
  main().catch((err) => {
    console.error(`ERRO: ${err.message}`);
    process.exit(1);
  });
}

export { gravar };
