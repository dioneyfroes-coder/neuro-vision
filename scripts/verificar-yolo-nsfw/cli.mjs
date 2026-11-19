import { existsSync } from "node:fs";
import path from "node:path";
import { MODELOS_CONJUNTO, ROOT } from "./constantes.mjs";
import { obterMimeEntrada, parsearArgumentos } from "./args.mjs";
import { descobrirFixturesNsfw } from "./fixtures.mjs";
import { verificarModelo } from "./avaliacao.mjs";
import { formatarBytes } from "./relatorio.mjs";

export async function main() {
  const config = parsearArgumentos(process.argv.slice(2));
  if (config.ajuda) {
    console.log(
      "Uso: node scripts/verificar-yolo-nsfw.mjs [modelo] [imagem|video ...] [limiar] [--amostras N] [--fixtures-nsfw] [--detalhado] [--conjunto]"
    );
    console.log(
      "  --detalhado/-v  imprime rotulo, score e caixa de cada marcacao (comparacao entre modelos)"
    );
    console.log(
      "  --conjunto      roda todos os modelos do conjunto NSFW e imprime um resumo comparativo"
    );
    console.log(
      "  --sem-isolamento desliga COOP/COEP (WASM em 1 thread) para medir o efeito do isolamento"
    );
    return;
  }
  // Em `--conjunto` o primeiro argumento pode ser o clipe (sem modelo): se ele
  // tem extensao de arquivo, entra como entrada em vez de nome de modelo.
  const modeloComoEntrada =
    config.conjunto && /\.[a-z0-9]+$/i.test(config.modelo) ? [config.modelo] : [];
  const entradasArg = config.fixturesNsfw
    ? [...modeloComoEntrada, ...config.entradas, ...(await descobrirFixturesNsfw())]
    : modeloComoEntrada.length || config.entradas.length
      ? [...modeloComoEntrada, ...config.entradas]
      : ["bench/videos/frames/frame-1.jpg"];
  if (!entradasArg.length) throw new Error("nenhuma fixture NSFW encontrada");
  const entradas = entradasArg.map((arquivo) => path.resolve(ROOT, arquivo));
  for (const [indice, entrada] of entradas.entries()) {
    if (!existsSync(entrada)) throw new Error(`arquivo nao encontrado: ${entradasArg[indice]}`);
    if (!obterMimeEntrada(entrada)) throw new Error(`formato nao suportado: ${entradasArg[indice]}`);
  }

  if (config.conjunto) {
    const resumos = [];
    const falhas = [];
    for (const chave of MODELOS_CONJUNTO) {
      console.log(`\n=== ${chave} ===`);
      try {
        resumos.push(await verificarModelo(chave, config, entradas));
      } catch (erro) {
        console.error(`FALHA ${chave}: ${erro.message}`);
        falhas.push({ chave, erro: erro.message });
      }
    }
    console.log("\n=== Resumo do conjunto ===");
    for (const resumo of resumos) {
      console.log(
        `${resumo.chave}: carga ${resumo.msCarga} ms | inferencia media ${resumo.msInferenciaMedia} ms/quadro | ` +
          `${resumo.marcacoes} marcacao(oes) em ${resumo.quadros} quadro(s) | ` +
          `memoria ${formatarBytes(resumo.memoriaInferenciaBytes)} (${resumo.memoriaMetodo}) | ` +
          `threads ${resumo.numThreads}`
      );
    }
    if (falhas.length) {
      console.error(`\n${falhas.length} modelo(s) falharam.`);
      process.exit(1);
    }
    return;
  }

  const chave = path.basename(config.modelo).replace(/\.onnx$/i, "");
  if (!/^[\w.-]+$/i.test(chave)) throw new Error("nome de modelo invalido");
  await verificarModelo(chave, config, entradas);
}