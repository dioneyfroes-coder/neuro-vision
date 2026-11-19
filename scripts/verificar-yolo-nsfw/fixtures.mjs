import { readdir } from "node:fs/promises";
import path from "node:path";
import { ROOT } from "./constantes.mjs";
import { obterMimeEntrada } from "./args.mjs";

export async function descobrirFixturesNsfw() {
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