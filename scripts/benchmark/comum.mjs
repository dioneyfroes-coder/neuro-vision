import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const BASE_URL_PADRAO = "http://localhost:1234";

export function mediana(valores) {
  if (!valores.length) return 0;
  const ordenado = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenado.length / 2);
  return ordenado.length % 2 ? ordenado[meio] : (ordenado[meio - 1] + ordenado[meio]) / 2;
}

export function arredondar(n, casas = 1) {
  const fator = 10 ** casas;
  return Math.round(n * fator) / fator;
}

/**
 * Inferencias por minuto sustentaveis pelo modelo, respeitando o ritmo do
 * cliente: cada analise espera `max(total + 500ms, intervalo minimo)`.
 */
export function inferenciasPorMinuto(totalMs, intervaloMinSeg) {
  const espera = Math.max((totalMs ?? 0) + 500, (intervaloMinSeg ?? 1) * 1000);
  return arredondar(60_000 / espera, 1);
}