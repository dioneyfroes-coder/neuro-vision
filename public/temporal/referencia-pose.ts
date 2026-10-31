import type { PontoCorporal } from "../../src/domain";

/**
 * Ponto de referencia estavel de uma pose (P2.2).
 *
 * O rastreamento de pessoas nao deve depender do centroide de **todos** os
 * keypoints: levantar um braco, virar a cabeca ou cruzar as pernas desloca o
 * centroide mesmo sem a pessoa sair do lugar. O torso (ombros + quadris) e bem
 * mais estavel para associar a mesma pessoa entre frames.
 *
 * Ordem de preferencia:
 * 1. `torso` — media do ponto medio dos ombros com o ponto medio dos quadris;
 * 2. `ombros` — apenas ombros (quadris ocultos);
 * 3. `quadris` — apenas quadris (ombros ocultos);
 * 4. `centroide` — ultimo recurso, media de todos os pontos validos.
 *
 * A `fonte` e preservada para diagnostico/testes: ela deixa explicito quando a
 * associacao caiu no fallback.
 */

/** Indices COCO (17 pontos) usados como referencia do torso. */
export const INDICES_TORSO = {
  ombroEsquerdo: 5,
  ombroDireito: 6,
  quadrilEsquerdo: 11,
  quadrilDireito: 12,
} as const;

/** Confianca minima para um keypoint sustentar a referencia. */
export const CONFIANCA_MINIMA_REFERENCIA = 0.05;

export type FonteReferenciaPose = "torso" | "ombros" | "quadris" | "centroide";

export interface ReferenciaPose {
  x: number;
  y: number;
  fonte: FonteReferenciaPose;
}

function pontoValido(ponto: PontoCorporal | undefined): ponto is PontoCorporal {
  if (!ponto || typeof ponto.x !== "number" || typeof ponto.y !== "number") return false;
  if (!Number.isFinite(ponto.x) || !Number.isFinite(ponto.y)) return false;
  return ponto.confianca === undefined || ponto.confianca >= CONFIANCA_MINIMA_REFERENCIA;
}

function media(pontos: readonly PontoCorporal[]): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  for (const ponto of pontos) {
    sx += ponto.x;
    sy += ponto.y;
  }
  return { x: sx / pontos.length, y: sy / pontos.length };
}

function parValido(
  pontos: readonly PontoCorporal[],
  a: number,
  b: number
): { x: number; y: number } | null {
  const pa = pontos[a];
  const pb = pontos[b];
  if (!pontoValido(pa) || !pontoValido(pb)) return null;
  return media([pa, pb]);
}

/**
 * Centroide de todos os pontos validos. Mantido como fallback e para as maos
 * (que nao tem torso).
 */
export function centroidePontos(
  pontos: readonly PontoCorporal[]
): { x: number; y: number } | null {
  const validos = pontos.filter(pontoValido);
  if (validos.length === 0) return null;
  return media(validos);
}

/**
 * Calcula a referencia de uma pose priorizando o torso. Retorna `null` apenas
 * quando nenhum ponto e valido.
 */
export function pontoReferenciaPose(
  pontos: readonly PontoCorporal[]
): ReferenciaPose | null {
  const ombros = parValido(
    pontos,
    INDICES_TORSO.ombroEsquerdo,
    INDICES_TORSO.ombroDireito
  );
  const quadris = parValido(
    pontos,
    INDICES_TORSO.quadrilEsquerdo,
    INDICES_TORSO.quadrilDireito
  );

  if (ombros && quadris) {
    const centro = media([
      { x: ombros.x, y: ombros.y },
      { x: quadris.x, y: quadris.y },
    ]);
    return { ...centro, fonte: "torso" };
  }
  if (ombros) return { ...ombros, fonte: "ombros" };
  if (quadris) return { ...quadris, fonte: "quadris" };

  const centro = centroidePontos(pontos);
  return centro ? { ...centro, fonte: "centroide" } : null;
}
