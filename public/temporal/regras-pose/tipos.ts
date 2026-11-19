/** Tipos e configuração das regras geométricas de pose compatível (indício, não prova). */

/** Nome estavel de cada regra geometrica. */
export type RegraPoseSexual =
  | "mao_proxima_genital"
  | "pernas_abertas"
  | "movimento_ritmico_punho";

/** Configuracao das regras geometricas. */
export interface ConfigRegrasPoseSexual {
  /** Confianca minima de cada ponto para entrar na regra. */
  confiancaMinimaPonto: number;
  /**
   * Distancia normalizada maxima entre mao/punho e a regiao genital estimada.
   * A regiao tambem aceita um raio proporcional a largura do quadril.
   */
  distanciaMaoGenital: number;
  /**
   * Razao minima entre a distancia dos joelhos (ou tornozelos) e a largura do
   * quadril para contar como "pernas abertas".
   */
  proporcaoPernasAbertas: number;
  /** Amostras de punho mantidas por lado para medir ritmo. */
  janelaRitmo: number;
  /** Amplitude normalizada minima (peak-to-peak) para considerar ritmo. */
  amplitudeRitmo: number;
  /** Inversoes de direcao necessarias para considerar movimento ritmico. */
  inversoesRitmo: number;
  /** Peso da mao proxima da genital no score final. */
  pesoMaoGenital: number;
  /** Peso das pernas abertas no score final. */
  pesoPernasAbertas: number;
  /** Peso do movimento ritmico no score final. */
  pesoRitmo: number;
  /** Score minimo para marcar a pose como compativel. */
  limiarCompativel: number;
}

export const CONFIG_REGRAS_POSE_SEXUAL_PADRAO: ConfigRegrasPoseSexual = {
  confiancaMinimaPonto: 0.5,
  distanciaMaoGenital: 0.12,
  proporcaoPernasAbertas: 1.2,
  janelaRitmo: 6,
  amplitudeRitmo: 0.03,
  inversoesRitmo: 2,
  pesoMaoGenital: 0.5,
  pesoPernasAbertas: 0.25,
  pesoRitmo: 0.25,
  limiarCompativel: 0.5,
};

/** Resultado da avaliacao de um frame para uma pessoa. */
export interface ResultadoRegraPose {
  /** Ha indicio geometrico suficiente (score >= limiar). */
  compativel: boolean;
  /** Score em [0, 1]; soma ponderada das regras atendidas. */
  confianca: number;
  /** Regras atendidas neste frame. */
  regras: RegraPoseSexual[];
  /** Evidencias textuais (regra + medidas) para o evento/prompt. */
  evidencias: string[];
}
