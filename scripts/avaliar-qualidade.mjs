#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "./avaliar-qualidade/cli.mjs";

export { TIPOS_IGNORADOS_PADRAO } from "./avaliar-qualidade/constantes.mjs";
export { carregarAnotacao } from "./avaliar-qualidade/anotacao.mjs";
export {
  lerInicioSidecarEventos,
  parsearEventos,
  resolverBaseMs,
} from "./avaliar-qualidade/eventos.mjs";
export { compararEventos } from "./avaliar-qualidade/comparacao.mjs";
export { formatarRelatorio } from "./avaliar-qualidade/relatorio.mjs";

const caminhoDoModulo = fileURLToPath(import.meta.url);
const executadoDiretamente =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === caminhoDoModulo;

if (executadoDiretamente) {
  main().catch((err) => {
    console.error(`ERRO: ${err.message}`);
    process.exit(1);
  });
}
