import path from "node:path";
import { ROOT } from "./constantes.mjs";

/** Parseia argumentos sem depender de shell (compativel com PowerShell). */
export function lerArgs(lista = process.argv.slice(2)) {
  const opcoes = {
    ciclos: path.join(ROOT, "logs", "ciclos.jsonl"),
    politica: undefined,
    fpsAlvo: 5,
    warmup: 0,
    minCiclos: 1,
    json: false,
    saida: undefined,
    ajuda: false,
  };
  for (let i = 0; i < lista.length; i += 1) {
    const arg = lista[i];
    const proximo = () => {
      i += 1;
      const valor = lista[i];
      if (valor === undefined || valor.startsWith("--")) {
        throw new Error(`Faltou valor para ${arg}`);
      }
      return valor;
    };
    if (arg === "--ciclos") opcoes.ciclos = path.resolve(ROOT, proximo());
    else if (arg === "--politica") opcoes.politica = proximo();
    else if (arg === "--fps-alvo") opcoes.fpsAlvo = Math.max(0.1, Number(proximo()) || 5);
    else if (arg === "--warmup") opcoes.warmup = Math.max(0, Math.floor(Number(proximo()) || 0));
    else if (arg === "--min-ciclos") opcoes.minCiclos = Math.max(1, Math.floor(Number(proximo()) || 1));
    else if (arg === "--json") opcoes.json = true;
    else if (arg === "--saida") opcoes.saida = path.resolve(ROOT, proximo());
    else if (arg === "--ajuda" || arg === "-h") opcoes.ajuda = true;
    else throw new Error(`Opcao desconhecida: ${arg}`);
  }
  return opcoes;
}
