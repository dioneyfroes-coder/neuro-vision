export const arredondar = (n, casas = 1) => {
  if (!Number.isFinite(n)) return null;
  const fator = 10 ** casas;
  return Math.round(n * fator) / fator;
};

export function mediana(valores) {
  const validos = valores.filter((n) => Number.isFinite(n));
  if (!validos.length) return null;
  const ordenado = [...validos].sort((a, b) => a - b);
  const meio = Math.floor(ordenado.length / 2);
  return ordenado.length % 2 ? ordenado[meio] : (ordenado[meio - 1] + ordenado[meio]) / 2;
}

/** Percentil por interpolacao linear (P95 = 0.95). */
export function percentil(valores, p) {
  const validos = valores.filter((n) => Number.isFinite(n));
  if (!validos.length) return null;
  const ordenado = [...validos].sort((a, b) => a - b);
  const pos = (ordenado.length - 1) * p;
  const base = Math.floor(pos);
  const resto = pos - base;
  const seguinte = ordenado[base + 1];
  return seguinte === undefined ? ordenado[base] : ordenado[base] + resto * (seguinte - ordenado[base]);
}
