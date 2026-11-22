import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Tipos de evento visual aceitos (ver `src/types.ts`). */
export const TIPOS = [
  "aparicao",
  "desaparecimento",
  "movimento",
  "mudanca_de_cena",
  "resumo",
  // Memória temporal (Fase 4): aceitos como esperados em anotações de clipe.
  "gesto_detectado",
  "interacao_objeto",
];
export const CATEGORIAS = [
  "gesto",
  "postura",
  "movimento_corporal",
  "movimento_objeto",
  "aparicao_desaparecimento",
  "interpretacao_textual",
];
export const VISIBILIDADES = ["clara", "parcial", "ocluida", "impossivel_de_determinar"];
export const PARTES_ENVOLVIDAS = [
  "mao_esquerda",
  "mao_direita",
  "ambas_as_maos",
  "braco_esquerdo",
  "braco_direito",
  "tronco",
  "corpo_inteiro",
  "objeto",
  "indeterminado",
];

/** Eventos que nao representam uma "mudanca" e por isso nao contam como falso positivo. */
export const TIPOS_IGNORADOS_PADRAO = ["resumo"];

export function lerArgs() {
  const mapa = { tolerancia: 3000, offset: 0, eventos: "logs/eventos.jsonl", json: false };
  const lista = process.argv.slice(2);
  for (let i = 0; i < lista.length; i++) {
    const a = lista[i];
    const proximo = () => lista[++i] ?? "";
    if (a === "--anotacao") mapa.anotacao = proximo();
    else if (a === "--eventos") mapa.eventos = proximo();
    else if (a === "--tolerancia") mapa.tolerancia = Math.max(0, Number(proximo()) || 0);
    else if (a === "--offset") mapa.offset = Number(proximo()) || 0;
    else if (a === "--ignorados") mapa.ignorados = proximo().split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--json") mapa.json = true;
  }
  return mapa;
}

export function arredondar(n, casas = 2) {
  const fator = 10 ** casas;
  return Math.round(n * fator) / fator;
}
