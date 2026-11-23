/**
 * Varredura de segredos no conteúdo versionado e no histórico Git (plano §12).
 *
 * Heurística determinística: lê somente texto, redige valores suspeitos e
 * devolve **candidatos para revisão humana**. Nunca afirma que o repositório
 * está livre de segredos — um padrão não detectado continua possível.
 *
 * Uso:
 *   npm run verificar:segredos:nsfw
 *   npm run verificar:segredos:nsfw -- --sem-historico [--json]
 */
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { varrerTrechosSegredos } from "../src/domain/varredura-segredos.ts";
import {
  auditarArquivosVersionados,
  classificarArquivoNsfw,
} from "../src/domain/auditoria-privacidade.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_BYTES = 1_048_576;
const GLOBS_TEXTO = [
  "*.ts", "*.js", "*.mjs", "*.cjs", "*.json", "*.md", "*.yml", "*.yaml",
  "*.html", "*.css", "*.example", ".env*",
];

function git(args, maxBuffer = 64 * 1024 * 1024) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer });
}

function lerArgs() {
  const mapa = { json: false, semHistorico: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === "--json") mapa.json = true;
    else if (arg === "--sem-historico") mapa.semHistorico = true;
    else if (arg === "--help" || arg === "-h") mapa.ajuda = true;
    else throw new Error(`argumento desconhecido: ${arg}`);
  }
  return mapa;
}

function caminhosVersionados() {
  return git(["ls-files", "-z"])
    .split("\0")
    .map((caminho) => caminho.trim())
    .filter((caminho) => caminho !== "");
}

async function trechosAtuais() {
  const trechos = [];
  for (const caminho of caminhosVersionados()) {
    const classe = classificarArquivoNsfw(caminho);
    if (classe !== "texto" && classe !== "segredo") continue;
    let conteudo;
    try {
      const bytes = await readFile(path.resolve(ROOT, caminho));
      if (bytes.length > MAX_BYTES) continue;
      conteudo = bytes.toString("utf8");
    } catch {
      continue;
    }
    const linhas = conteudo.split(/\r?\n/);
    linhas.forEach((texto, indice) => {
      trechos.push({ caminho, linha: indice + 1, texto, origem: "atual" });
    });
  }
  return trechos;
}

function trechosHistorico() {
  const saida = git(["log", "--all", "-p", "--no-color", "--unified=0", "--", ...GLOBS_TEXTO]);
  const trechos = [];
  let caminho = "";
  let linha = 1;
  for (const linhaDiff of saida.split(/\r?\n/)) {
    if (linhaDiff.startsWith("+++ ")) {
      const alvo = linhaDiff.slice(4).trim();
      caminho = alvo.startsWith("b/") ? alvo.slice(2) : "";
      linha = 1;
      continue;
    }
    const hunk = linhaDiff.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      linha = Number(hunk[1]);
      continue;
    }
    if (caminho && linhaDiff.startsWith("+") && !linhaDiff.startsWith("+++")) {
      trechos.push({ caminho, linha, texto: linhaDiff.slice(1), origem: "historico" });
      linha += 1;
    }
  }
  return trechos;
}

function caminhosHistorico() {
  return [
    ...new Set(
      git(["log", "--all", "--pretty=format:", "--name-only"])
        .split(/\r?\n/)
        .map((caminho) => caminho.trim())
        .filter((caminho) => caminho !== "")
    ),
  ];
}

/** Função pura: saídas já extraídas entram explicitamente, sem git nem fs. */
export function gerarRelatorioSeguranca(entrada = {}) {
  const atual = varrerTrechosSegredos(entrada.trechosAtuais ?? []);
  const historico = varrerTrechosSegredos(entrada.trechosHistorico ?? []);
  const caminhos = auditarArquivosVersionados(entrada.caminhosHistorico ?? []);
  const candidatos = atual.totalAchados + historico.totalAchados;
  const status =
    candidatos > 0 ? "CANDIDATOS" : caminhos.status === "atencao" ? "ATENCAO" : "SEM_CANDIDATOS";
  return {
    status,
    base: "heuristica-textual",
    commits: entrada.commits ?? 0,
    atual,
    historico,
    caminhosHistorico: caminhos,
    observacoes: [
      "SEM_CANDIDATOS nao prova ausencia de segredos",
      "caminhos sensiveis no historico exigem revisao, nao exclusao automatica",
      "valores suspeitos sao redigidos no relatorio",
    ],
  };
}

export async function main() {
  const args = lerArgs();
  if (args.ajuda) {
    console.log("Uso: npm run verificar:segredos:nsfw -- [--sem-historico] [--json]");
    return;
  }
  const entrada = {
    trechosAtuais: await trechosAtuais(),
    trechosHistorico: args.semHistorico ? [] : trechosHistorico(),
    caminhosHistorico: args.semHistorico ? caminhosVersionados() : caminhosHistorico(),
    commits: Number(git(["rev-list", "--all", "--count"]).trim()),
  };
  const relatorio = gerarRelatorioSeguranca(entrada);
  if (args.json) {
    console.log(JSON.stringify(relatorio, null, 2));
    return;
  }
  console.log(`Varredura de segredos (NSFW) — ${relatorio.status}`);
  console.log(
    `Commits: ${relatorio.commits} · trechos atuais: ${relatorio.atual.trechos} · ` +
      `trechos no historico: ${relatorio.historico.trechos}`
  );
  console.log(
    `Conteudo atual: ${relatorio.atual.status} (${relatorio.atual.totalAchados} candidato(s))`
  );
  console.log(
    `Conteudo no historico: ${relatorio.historico.status} ` +
      `(${relatorio.historico.totalAchados} candidato(s))`
  );
  console.log(
    `Caminhos no historico: ${relatorio.caminhosHistorico.status} — ` +
      `${relatorio.caminhosHistorico.arquivos} arquivo(s), ` +
      `${relatorio.caminhosHistorico.caminhosSensiveis.length} sensivel(is)`
  );
  for (const caminho of relatorio.caminhosHistorico.caminhosSensiveis) {
    console.log(`  historico: ${caminho}`);
  }
  for (const achado of [...relatorio.atual.achados, ...relatorio.historico.achados]) {
    console.log(
      `  candidato ${achado.origem}: ${achado.caminho}:${achado.linha} ` +
        `[${achado.tipo}] ${achado.valorRedigido}`
    );
  }
  if (relatorio.atual.truncado || relatorio.historico.truncado) {
    console.log("  lista de candidatos truncada; use --json para contagem total");
  }
  console.log("Resultado heurístico: nenhuma ausência de segredo é afirmada.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
