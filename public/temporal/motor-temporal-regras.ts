import type { PessoaPose, PontoCorporal } from "../../src/domain";
import type { Entidade, Sonda } from "./rastreador-entidades";

/**
 * Indices COCO (17 pontos) usados na relacao articular do braco erguido.
 * Cada lado combina ombro, cotovelo e punho.
 */
export const ARTICULACOES_BRACO = [
  { ombro: 5, cotovelo: 7, punho: 9 }, // lado esquerdo
  { ombro: 6, cotovelo: 8, punho: 10 }, // lado direito
] as const;

/**
 * Confianca minima do punho da pose para sustentar a associacao mao <-> pessoa.
 * Mais permissiva que a regra de braco levantado: aqui o punho apenas indica
 * proximidade, nao uma conclusao postural.
 */
export const CONFIANCA_MINIMA_PUNHO_MAO_PESSOA = 0.3;

/**
 * Restricao de lateralidade na associacao de maos.
 *
 * Lateralidade desconhecida nao bloqueia (nao ha evidencia para restringir);
 * esquerda e direita nunca se associam entre si.
 */
export function podeAssociarMao(entidade: Entidade, sonda: Sonda): boolean {
  const atual = entidade.meta.lateralidade;
  const nova = sonda.meta?.lateralidade;
  if (atual === undefined || nova === undefined) return true;
  if (atual === "desconhecida" || nova === "desconhecida") return true;
  return atual === nova;
}

/**
 * Continuidade temporal da entidade: valida quando o ultimo intervalo usado
 * para velocidade foi positivo e curto o bastante. A primeira observacao nao
 * invalida a continuidade (ainda nao ha intervalo).
 *
 * Ausencia de observacao (`framesAusente > 0`) **nao** invalida a continuidade:
 * ela e representada por `observada: false` e explicada pelo motivo de
 * encerramento (`oclusao`). Apenas intervalos invalidos/longos a invalidam.
 */
export function continuidadeDaEntidade(entidade: Entidade): boolean {
  if (entidade.framesVisto <= 1) return true;
  return entidade.velocidadeValida;
}

export function arredondar(valor: number, decimais = 3): number {
  const fator = 10 ** decimais;
  return Math.round(valor * fator) / fator;
}

/**
 * Detecta se ha um **braco erguido** usando a relacao articular: o punho precisa
 * estar acima do limiar, acima do ombro do mesmo lado e acima do cotovelo do
 * mesmo lado, com os tres pontos confiaveis.
 *
 * A relacao evita falsos positivos de um punho alto por ruido (sem ombro/
 * cotovelo coerentes) e mantem o teste deterministico. Retorna a confianca do
 * punho mais alto, ou `null` se nenhum lado satisfaz a relacao.
 */
export function punhoErguido(
  pose: PessoaPose,
  limiar: number,
  confiancaMinima: number
): { confianca: number } | null {
  let melhorY: number | null = null;
  let confianca = 0;
  for (const { ombro, cotovelo, punho } of ARTICULACOES_BRACO) {
    const pOmbro = pontoConfiavel(pose.pontos[ombro], confiancaMinima);
    const pCotovelo = pontoConfiavel(pose.pontos[cotovelo], confiancaMinima);
    const pPunho = pontoConfiavel(pose.pontos[punho], confiancaMinima);
    if (!pOmbro || !pCotovelo || !pPunho) continue;
    // Punho acima do limiar (topo = 0), acima do ombro e acima do cotovelo.
    if (pPunho.y > limiar) continue;
    if (pPunho.y >= pOmbro.y) continue;
    if (pPunho.y >= pCotovelo.y) continue;
    if (melhorY === null || pPunho.y < melhorY) {
      melhorY = pPunho.y;
      confianca = pPunho.confianca ?? 1;
    }
  }
  return melhorY === null ? null : { confianca };
}

/** Ponto com confianca suficiente (ou sem confianca declarada, tratado como valido). */
export function pontoConfiavel(
  ponto: PontoCorporal | undefined,
  confiancaMinima: number
): PontoCorporal | null {
  if (!ponto || typeof ponto.x !== "number" || typeof ponto.y !== "number") return null;
  if (ponto.confianca !== undefined && ponto.confianca < confiancaMinima) return null;
  return ponto;
}
