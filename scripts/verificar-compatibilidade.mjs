#!/usr/bin/env node

/** Verifica se as versoes fixadas de runtimes e Node estao sincronizadas. */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ARQUIVOS, verificarCompatibilidade } from "./verificar-compatibilidade/nucleo.mjs";

export { ARQUIVOS, verificarCompatibilidade };

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Le os arquivos do repositorio; ausencia vira texto vazio e, portanto, problema explicito. */
export async function verificarNoDisco(raiz = RAIZ) {
  const textos = {};
  const ausentes = [];
  for (const [chave, relativo] of Object.entries(ARQUIVOS)) {
    const conteudo = await readFile(path.resolve(raiz, relativo), "utf8").catch(() => null);
    if (conteudo === null) ausentes.push(relativo);
    textos[chave] = conteudo ?? "";
  }
  const resultado = verificarCompatibilidade(textos);
  if (ausentes.length) {
    resultado.ok = false;
    resultado.problemas.unshift(`Arquivo(s) nao encontrado(s): ${ausentes.join(", ")}.`);
  }
  return resultado;
}

const executadoDiretamente =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (executadoDiretamente) {
  const resultado = await verificarNoDisco();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(resultado, null, 2));
  } else if (resultado.ok) {
    console.log(
      `Compatibilidade OK — mediapipe ${resultado.versoes.mediapipe}, ` +
        `transformers ${resultado.versoes.transformers}, ` +
        `onnxruntime ${resultado.versoes.onnxruntime}.`
    );
  } else {
    console.error("Incompatibilidade detectada:");
    for (const problema of resultado.problemas) console.error(`  - ${problema}`);
  }
  process.exitCode = resultado.ok ? 0 : 1;
}
