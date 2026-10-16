/**
 * Suavizacao exponencial e metricas de movimento em coordenadas normalizadas.
 *
 * Tudo aqui e puro (sem estado global) para permitir testes deterministicos.
 */

/** Media movel exponencial: `alpha` e o peso do valor anterior (0..1). */
export function suavizarExponencial(
  alpha: number,
  anterior: number,
  atual: number
): number {
  const a = clamp01(alpha);
  return a * anterior + (1 - a) * atual;
}

/** Ponto 2D em coordenadas normalizadas [0,1]. */
export interface Ponto2D {
  x: number;
  y: number;
}

/** Suaviza um ponto componente a componente. */
export function suavizarPonto(
  alpha: number,
  anterior: Ponto2D | null,
  atual: Ponto2D
): Ponto2D {
  if (!anterior) return { x: atual.x, y: atual.y };
  return {
    x: suavizarExponencial(alpha, anterior.x, atual.x),
    y: suavizarExponencial(alpha, anterior.y, atual.y),
  };
}

/** Distancia euclidiana entre dois pontos normalizados. */
export function distanciaPontos(a: Ponto2D, b: Ponto2D): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Metrica de movimento entre dois pontos: magnitude do deslocamento e o
 * componente vertical (negativo = subindo, pois o topo e y = 0).
 */
export interface MetricaMovimento {
  deslocamento: number;
  deslocamentoY: number;
}

export function medirMovimento(anterior: Ponto2D, atual: Ponto2D): MetricaMovimento {
  return {
    deslocamento: distanciaPontos(anterior, atual),
    deslocamentoY: atual.y - anterior.y,
  };
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.min(1, Math.max(0, v));
}
