

export const arredondar = (n, casas = 0) => {
  if (!Number.isFinite(n)) return null;
  const fator = 10 ** casas;
  return Math.round(n * fator) / fator;
};

export function mediana(valores) {
  if (!valores.length) return null;
  const ordenado = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenado.length / 2);
  return ordenado.length % 2 ? ordenado[meio] : (ordenado[meio - 1] + ordenado[meio]) / 2;
}

/** Percentil por interpolacao linear (P95 = 0.95). */
export function percentil(valores, p) {
  if (!valores.length) return null;
  const ordenado = [...valores].sort((a, b) => a - b);
  const pos = (ordenado.length - 1) * p;
  const base = Math.floor(pos);
  const resto = pos - base;
  const proximo = ordenado[base + 1];
  return proximo === undefined ? ordenado[base] : ordenado[base] + resto * (proximo - ordenado[base]);
}

/**
 * Probabilidade pontual de Binomial(n, p) em k, por recorrencia (sem fatorial).
 * Base do intervalo de confianca da mediana por ordem estatistica.
 */
export function probabilidadeBinomial(n, p, k) {
  if (k < 0 || k > n) return 0;
  const q = 1 - p;
  let valor = q ** n;
  for (let i = 0; i < k; i++) {
    valor *= ((n - i) / (i + 1)) * (p / q);
  }
  return valor;
}

/**
 * Intervalo de confianca para a MEDIANA por ordem estatistica (distribution-free),
 * deterministico e sem reamostragem. Devolve `null` quando a amostra nao basta
 * para um intervalo nao trivial: com 95% e n < 10 o intervalo seria o proprio
 * min..max e nao informaria incerteza alguma. Nunca inventa um IC.
 */
export function intervaloConfiancaMediana(
  valores,
  { confianca = 0.95, minimoAmostras = 10 } = {}
) {
  const ordenado = valores.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  const n = ordenado.length;
  if (n < Math.max(2, minimoAmostras)) return null;
  const alvo = (1 - confianca) / 2;
  let acumulado = 0;
  let r = -1; // maior r com P(X <= r) <= alvo
  for (let j = 0; j <= n; j++) {
    acumulado += probabilidadeBinomial(n, 0.5, j);
    if (acumulado <= alvo) r = j;
    else break;
  }
  const k = r + 1; // indice 1-based do limite inferior
  if (k < 1 || k > n - k + 1) return null;
  return {
    inferiorMs: arredondar(ordenado[k - 1]),
    superiorMs: arredondar(ordenado[n - k]),
    confianca,
    amostras: n,
    metodo: "ordem-estatistica",
  };
}

/** Converte um valor de CLI para o intervalo [0, 1] (NaN vira 0). */
export function clamp01(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** Soma com valores ausentes tratados como 0 (nunca NaN). */
export function somaSegura(valores) {
  return valores.reduce((acc, n) => acc + (Number.isFinite(n) ? n : 0), 0);
}

/**
 * F1 somente quando precisao E recall existem (denominadores definidos).
 * `null` significa N/A; nao vira 0 nem "1 silencioso".
 */
export const f1 = (precisao, recall) => {
  if (!Number.isFinite(precisao) || !Number.isFinite(recall)) return null;
  return precisao + recall > 0 ? (2 * precisao * recall) / (precisao + recall) : 0;
};

export function dataHoraCurta(agora = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${agora.getFullYear()}${p(agora.getMonth() + 1)}${p(agora.getDate())}`;
}

/** Percentual curto (0..1) para mensagens de gate, sem arredondar centavos. */
export function pctCurto(n) {
  return Number.isFinite(n) ? `${(Math.round(n * 1000) / 10).toFixed(1)}%` : "N/A";
}

// ---------------------------------------------------------------------------
// Relatorios (Markdown)
// ---------------------------------------------------------------------------

export const pct = (n) => (Number.isFinite(n) ? `${Math.round(n * 100)}%` : "N/A");

export const num = (n, casas = 2) => (Number.isFinite(n) ? arredondar(n, casas) : "N/A");

/** Escapa `|` para celulas de tabela Markdown (ex.: modo "deteccao|eventos"). */
export const celula = (texto) => String(texto).replace(/\|/g, "\\|");

/** Converte bytes em MB com uma casa, sem esconder ausencia de amostra. */
export function megabytes(bytes) {
  return Number.isFinite(bytes) ? arredondar(bytes / (1024 * 1024), 1) : null;
}
