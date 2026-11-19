import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Subsistemas na mesma ordem de `src/domain/cadencia.ts`. */
export const SUBSISTEMAS = ["deteccao", "pose", "maos", "nsfw"];

export const USO = `
Uso: node scripts/benchmark-cadencia.mjs [opcoes]

Le ciclos ja persistidos e resume a amostragem efetiva e a latencia por etapa.

Opcoes:
  --ciclos <arquivo>    JSONL de RegistroCiclo (padrao: logs/ciclos.jsonl)
  --politica <id>       Filtra ciclos pela politica aplicada (ex.: benchmark-5fps)
  --fps-alvo <n>        Alvo de FPS para maos (padrao: 5)
  --warmup <n>          Descarta os N primeiros ciclos concluidos (padrao: 0)
  --min-ciclos <n>      Minimo de ciclos para dar veredito (padrao: 1)
  --json                Imprime o resumo estruturado (JSON) em vez da tabela
  --saida <arquivo>     Grava o relatorio Markdown no caminho indicado
  --ajuda               Mostra esta mensagem
`.trim();
