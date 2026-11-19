import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ROOT } from "./comum.mjs";

/**
 * Versao do codigo em execucao: commit, branch e se havia alteracoes locais.
 * Best-effort — fora de um repositorio Git (ou sem `git` no PATH) devolve null.
 */
export function versaoDoCodigo() {
  const git = (...args) =>
    execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  try {
    return {
      commit: git("rev-parse", "HEAD"),
      branch: git("rev-parse", "--abbrev-ref", "HEAD"),
      alteracoesLocais: git("status", "--porcelain").length > 0,
    };
  } catch {
    return null;
  }
}

/**
 * Metadados de ambiente gravados junto a cada benchmark, para que os numeros
 * sejam comparaveis (mesmo hardware, codigo, modelo e configuracoes).
 */
export function montarAmbiente() {
  const cpus = os.cpus();
  return {
    dataHora: new Date().toISOString(),
    node: process.version,
    plataforma: `${os.platform()} ${os.release()}`,
    arquitetura: os.arch(),
    cpu: (cpus[0]?.model ?? "desconhecido").trim(),
    nucleosLogicos: cpus.length,
    memoriaTotalBytes: os.totalmem(),
    codigo: versaoDoCodigo(),
  };
}

/** Resolve o conjunto fixo de imagens: caminhos explicitos ou um dos diretorios. */
export async function resolverImagens(explicitas, dirs = []) {
  const paraObjeto = async (caminho) => {
    const abs = path.resolve(ROOT, caminho);
    const dados = await readFile(abs);
    return { nome: path.basename(abs), base64: dados.toString("base64") };
  };

  if (explicitas?.length) {
    return Promise.all(explicitas.map(paraObjeto));
  }

  for (const pasta of dirs.filter(Boolean)) {
    const absoluta = path.resolve(ROOT, pasta);
    const arquivos = (await readdir(absoluta).catch(() => []))
      .filter((f) => /\.(jpg|jpeg|png)$/i.test(f) && !/^nsfw(?:[\s_-]|$)/i.test(f))
      .sort();
    if (arquivos.length) {
      return Promise.all(arquivos.map((f) => paraObjeto(path.join(pasta, f))));
    }
  }
  return [];
}