#!/usr/bin/env node

/**
 * Baixa bibliotecas e pesos para o **modo offline** (servidos pelo proprio
 * servidor Node), eliminando a dependencia de CDN/rede em execucao.
 *
 * As pastas `vendor/` e `modelos/` sao **gitignored** (como `yolonsfw/`): os
 * arquivos nunca sao commitados; quem quiser offline roda este script uma vez.
 * Sem elas, o app continua funcionando com o CDN como fallback — nada quebra.
 *
 * Uso:
 *   node scripts/preparar-offline.mjs              # baixa o que falta
 *   node scripts/preparar-offline.mjs --forcar     # rebaixa tudo
 *   node scripts/preparar-offline.mjs --apenas libs
 *   node scripts/preparar-offline.mjs --apenas pesos
 *   node scripts/preparar-offline.mjs --listar     # so mostra o manifesto
 *
 * O download e retomavel no nivel de arquivo: cada arquivo so e baixado se
 * faltar ou se `--forcar`. A integridade e conferida pelo `Content-Length`
 * quando o servidor informa o tamanho.
 */

import { createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import { rm, rename } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import { BIBLIOTECAS, PESOS, VERSOES } from "./offline-manifest.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR_VENDOR = path.join(ROOT, "vendor");
const DIR_MODELOS = path.join(ROOT, "modelos");

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
    apenas: lista.includes("--apenas") ? lista[lista.indexOf("--apenas") + 1] : null,
  };
}

/**
 * Baixa um arquivo para `destino` (escrita em `.parcial` e rename atomico).
 * Reusa o arquivo se ja existir e o `--forcar` nao estiver ligado.
 */
async function baixar({ origem, destino }, baseDir, { forcar }) {
  const alvo = path.join(baseDir, destino);
  const rel = path.relative(ROOT, alvo).replace(/\\/g, "/");

  if (existsSync(alvo) && !forcar) {
    const bytes = statSync(alvo).size;
    console.log(`  ok      ${rel} (${formatarBytes(bytes)}, ja existe)`);
    return { pulado: true, bytes };
  }

  mkdirSync(path.dirname(alvo), { recursive: true });
  const parcial = `${alvo}.parcial`;

  let resposta;
  try {
    resposta = await fetch(origem, { redirect: "follow" });
  } catch (err) {
    throw new Error(`falha de rede em ${origem}: ${err.message}`, { cause: err });
  }
  if (!resposta.ok || !resposta.body) {
    throw new Error(`HTTP ${resposta.status} em ${origem}`);
  }

  const esperado = Number(resposta.headers.get("content-length")) || 0;
  // O fetch descomprime `content-encoding` automaticamente, mas o
  // `Content-Length` continua sendo o do corpo comprimido: so compare quando o
  // servidor nao enviou compressao.
  const comprimido = Boolean(resposta.headers.get("content-encoding"));
  try {
    await pipeline(Readable.fromWeb(resposta.body), createWriteStream(parcial));
  } catch (err) {
    await rm(parcial, { force: true });
    throw new Error(`falha ao gravar ${rel}: ${err.message}`, { cause: err });
  }

  const baixado = statSync(parcial).size;
  if (esperado && !comprimido && baixado !== esperado) {
    await rm(parcial, { force: true });
    throw new Error(
      `tamanho divergente em ${rel}: esperado ${esperado}, obtido ${baixado} (parcial removido)`
    );
  }
  if (baixado === 0) {
    await rm(parcial, { force: true });
    throw new Error(`arquivo vazio em ${origem}`);
  }

  await rename(parcial, alvo);
  console.log(`  baixado ${rel} (${formatarBytes(baixado)})`);
  return { pulado: false, bytes: baixado };
}

/** Percorre os grupos de um manifesto (bibliotecas ou pesos). */
async function baixarGrupos(grupos, baseDir, opcoes) {
  const resultado = { novos: 0, pulados: 0, bytes: 0, falhas: [] };
  for (const grupo of grupos) {
    console.log(`\n${grupo.nome}:`);
    for (const item of grupo.itens) {
      try {
        const r = await baixar(item, baseDir, opcoes);
        if (r.pulado) resultado.pulados += 1;
        else {
          resultado.novos += 1;
          resultado.bytes += r.bytes;
        }
      } catch (err) {
        console.error(`  FALHA   ${item.destino}: ${err.message}`);
        resultado.falhas.push({ item: item.destino, erro: err.message });
      }
    }
  }
  return resultado;
}

function listarManifesto() {
  console.log(`Versoes fixas: mediapipe ${VERSOES.mediapipe}, transformers ${VERSOES.transformers}, onnxruntime ${VERSOES.onnxruntime}\n`);
  console.log(`vendor/ (bibliotecas):`);
  for (const grupo of BIBLIOTECAS) {
    for (const item of grupo.itens) console.log(`  vendor/${item.destino}`);
  }
  console.log(`\nmodelos/ (pesos):`);
  for (const grupo of PESOS) {
    for (const item of grupo.itens) console.log(`  modelos/${item.destino}`);
  }
}

function ajuda() {
  console.log("Uso: node scripts/preparar-offline.mjs [--forcar] [--apenas libs|pesos] [--listar]");
  console.log("");
  console.log("Baixa bibliotecas (vendor/) e pesos (modelos/) para rodar 100% offline.");
  console.log("Ambas as pastas sao gitignored; sem elas o app usa o CDN como fallback.");
  console.log("");
  console.log("  --forcar          rebaixa tudo, mesmo o que ja existe");
  console.log("  --apenas libs     apenas as bibliotecas (vendor/)");
  console.log("  --apenas pesos    apenas os pesos (modelos/)");
  console.log("  --listar          mostra o que seria baixado, sem baixar");
}

async function main() {
  const opcoes = lerArgs();
  if (opcoes.ajuda) return ajuda();
  if (opcoes.listar) return listarManifesto();

  const grupos = [];
  if (!opcoes.apenas || opcoes.apenas === "libs" || opcoes.apenas === "bibliotecas") {
    grupos.push({ nome: "Bibliotecas (vendor/)", grupos: BIBLIOTECAS, base: DIR_VENDOR });
  }
  if (!opcoes.apenas || opcoes.apenas === "pesos" || opcoes.apenas === "modelos") {
    grupos.push({ nome: "Pesos (modelos/)", grupos: PESOS, base: DIR_MODELOS });
  }
  if (grupos.length === 0) {
    console.error(`Valor invalido para --apenas: ${opcoes.apenas} (use "libs" ou "pesos").`);
    process.exit(1);
  }

  console.log(
    `Preparando modo offline em ${path.relative(ROOT, ROOT) || "."} ` +
      `(${opcoes.forcar ? "rebaixando tudo" : "reusando o que existe"}).`
  );

  const falhas = [];
  let novos = 0;
  let pulados = 0;
  let bytes = 0;
  for (const grupo of grupos) {
    console.log(`\n=== ${grupo.nome} ===`);
    const r = await baixarGrupos(grupo.grupos, grupo.base, opcoes);
    novos += r.novos;
    pulados += r.pulados;
    bytes += r.bytes;
    falhas.push(...r.falhas);
  }

  console.log(`\nResumo: ${novos} baixado(s), ${pulados} ja presente(s), ${formatarBytes(bytes)}.`);
  if (falhas.length) {
    console.error(`${falhas.length} falha(s):`);
    for (const f of falhas) console.error(`  - ${f.item}: ${f.erro}`);
    process.exit(1);
  }
  console.log("Modo offline pronto. O app passa a usar os arquivos locais automaticamente.");
}

main().catch((err) => {
  console.error(`Erro inesperado: ${err.message}`);
  process.exit(1);
});
