/** Limites de resolucao/normalizacao usados na montagem do schema. */
export interface OpcoesSerializacao {
  /** Casas decimais para coordenadas/confiancas. */
  decimais: number;
  /** Inclui os 21 landmarks de mao (em vez do subconjunto compacto). */
  landmarksCompletos: boolean;
  /**
   * Inclui a geometria da mao (angulos articulares e dedos estendidos),
   * calculada sobre os 21 landmarks mesmo no modo compacto. Padrao: `true`.
   */
  geometriaMao: boolean;
  /** Confianca minima para manter um keypoint nomeado no registro. */
  confiancaMinimaKeypoint: number;
  /** Maximo de keypoints nomeados por pessoa (os mais confiaveis). */
  maxKeypointsPorPessoa: number;
  /** Confianca minima para manter uma deteccao no registro. */
  confiancaMinimaDeteccao: number;
  /** Maximo de deteccoes por frame. */
  maxDeteccoesPorFrame: number;
  /** Maximo de pessoas por frame. */
  maxPessoasPorFrame: number;
  /** Maximo de maos por frame. */
  maxMaosPorFrame: number;
}

export const OPCOES_SERIALIZACAO_PADRAO: OpcoesSerializacao = {
  decimais: 2,
  landmarksCompletos: false,
  geometriaMao: true,
  confiancaMinimaKeypoint: 0.3,
  maxKeypointsPorPessoa: 17,
  confiancaMinimaDeteccao: 0,
  maxDeteccoesPorFrame: 20,
  maxPessoasPorFrame: 8,
  maxMaosPorFrame: 8,
};
