#!/usr/bin/env node
/**
 * Gera o conjunto fixo de imagens do benchmark (`scripts/benchmark.mjs`).
 *
 * Sao cenas sinteticas em resolucoes tipicas de webcam, usadas para medir
 * latencia/prefill de forma reproduzivel sem depender de snapshots locais. O
 * conteudo e deterministico: rodar de novo produz exatamente os mesmos bytes.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEST = path.join(ROOT, "bench", "imagens");

const CRC_TABELA = (() => {
  const tabela = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabela[n] = c >>> 0;
  }
  return tabela;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABELA[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(tipo, dados) {
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(dados.length, 0);
  const corpo = Buffer.concat([Buffer.from(tipo, "ascii"), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo), 0);
  return Buffer.concat([tamanho, corpo, crc]);
}

/** Codifica um PNG RGB (8 bits) a partir de uma funcao `pixel(x, y)`. */
function codificarPng(largura, altura, pixel) {
  const assinatura = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8; // profundidade de bits
  ihdr[9] = 2; // cor: RGB
  const linhas = [];
  for (let y = 0; y < altura; y++) {
    const linha = Buffer.alloc(1 + largura * 3);
    for (let x = 0; x < largura; x++) {
      const [r, g, b] = pixel(x, y);
      const o = 1 + x * 3;
      linha[o] = r;
      linha[o + 1] = g;
      linha[o + 2] = b;
    }
    linhas.push(linha);
  }
  const idat = zlib.deflateSync(Buffer.concat(linhas), { level: 9 });
  return Buffer.concat([
    assinatura,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Cena generica: gradiente de fundo + faixas que imitam uma mesa e um objeto. */
function cena(x, y, largura, altura) {
  const fundo = Math.round(40 + (y / altura) * 60);
  let r = fundo;
  let g = fundo + 10;
  let b = fundo + 25;

  const mesaY = Math.round(altura * 0.72);
  if (y >= mesaY) {
    r = 90;
    g = 60;
    b = 35;
  }

  const objetoX = Math.round(largura * 0.35);
  const objetoLargura = Math.round(largura * 0.3);
  const objetoTopo = Math.round(altura * 0.25);
  const objetoBase = Math.round(altura * 0.7);
  if (x >= objetoX && x < objetoX + objetoLargura && y >= objetoTopo && y < objetoBase) {
    r = 210;
    g = 180;
    b = 120;
  }

  return [r & 0xff, g & 0xff, b & 0xff];
}

async function main() {
  await mkdir(DEST, { recursive: true });
  const alvos = [
    { nome: "cena-640x480.png", largura: 640, altura: 480 },
    { nome: "cena-1280x720.png", largura: 1280, altura: 720 },
  ];
  for (const alvo of alvos) {
    const dados = codificarPng(alvo.largura, alvo.altura, (x, y) =>
      cena(x, y, alvo.largura, alvo.altura)
    );
    const destino = path.join(DEST, alvo.nome);
    await writeFile(destino, dados);
    console.log(`gerado ${path.relative(ROOT, destino)} (${dados.length} bytes)`);
  }
}

main().catch((err) => {
  console.error(`ERRO: ${err.message}`);
  process.exit(1);
});
