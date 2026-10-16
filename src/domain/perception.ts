/**
 * Contratos normalizados da percepcao local (roteiro 4.2 e 5.2).
 *
 * Estes tipos descrevem a **evidencia estruturada** produzida pelos adaptadores
 * de detector, pose e maos. Nenhum tipo aqui importa APIs de SDK de modelo
 * (Transformers.js, MediaPipe, YOLO) — a regra e imposta pelo eslint em
 * `src/domain/**`.
 */

/** Caixa delimitadora em pixels da imagem analisada. */
export interface Caixa {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}

/**
 * Marcador de subsistema indisponivel (falha ou desativado).
 *
 * Regra 8 do roteiro: falha nao significa ausencia. Este valor **nao** pode ser
 * convertido em lista vazia indistinguivel de uma inferencia valida sem
 * resultados — use `estaIndisponivel` para distinguir.
 */
export interface ResultadoIndisponivel {
  indisponivel: true;
  /** Subsistema que falhou/faltou. */
  subsistema: "deteccao" | "pose" | "maos";
  /** Motivo legivel (erro, timeout, desativado por config). */
  motivo: string;
}

export function indisponivel(
  subsistema: ResultadoIndisponivel["subsistema"],
  motivo: string
): ResultadoIndisponivel {
  return { indisponivel: true, subsistema, motivo };
}

export function estaIndisponivel(
  valor: { indisponivel?: boolean } | null | undefined
): valor is ResultadoIndisponivel {
  return valor !== null && valor !== undefined && valor.indisponivel === true;
}

/** Deteccao de um objeto em um frame. */
export interface Deteccao {
  /** Rotulo exibivel em portugues (ex.: `pessoa`). */
  nome: string;
  /** Rotulo original do detector (ex.: `person`). */
  rotulo: string;
  /** Confianca em [0, 1]. */
  score: number;
  caixa: Caixa;
}

/** Resultado do detector de objetos para um frame. */
export interface ResultadoDeteccaoLocal {
  deteccoes: Deteccao[];
  /** Dimensoes reais da imagem analisada, para normalizar caixas/coordenadas. */
  dimensoes: { largura: number; altura: number };
  /** Modelo/motor que produziu o resultado (quando conhecido). */
  modelo?: string;
}

/** Ponto-chave corporal em coordenadas normalizadas [0,1] (quando houver). */
export interface PontoCorporal {
  x: number;
  y: number;
  /** Confianca do ponto, quando o modelo a expoe. */
  confianca?: number;
}

/** Pose de uma pessoa: pontos-chave na ordem conhecida do estimador. */
export interface PessoaPose {
  /** Id estavel dentro da sessao (atribuido pelo rastreador de pose). */
  entidadeId?: string;
  pontos: PontoCorporal[];
  /** Confianca agregada da pessoa, quando disponivel. */
  confianca?: number;
}

/** Resultado do estimador de pose para um frame. */
export interface ResultadoPose {
  pessoas: PessoaPose[];
  modelo?: string;
}

/** Landmark de mao em coordenadas normalizadas [0,1]. */
export interface LandmarkMao {
  x: number;
  y: number;
  z?: number;
}

/** Classificacao de gesto entregue pelo reconhecedor, quando houver. */
export interface ClassificacaoGesto {
  /** Nome normalizado do gesto (ex.: `polegar_para_cima`). */
  nome: string;
  /** Confianca em [0, 1]. */
  confianca: number;
}

/** Uma mao detectada em um frame. */
export interface MaoDetectada {
  /** Id estavel dentro da sessao (atribuido pelo rastreador de maos). */
  entidadeId?: string;
  lateralidade: "esquerda" | "direita" | "desconhecida";
  landmarks: LandmarkMao[];
  /** Classificacao de gesto do modelo, quando o classificador esta disponivel. */
  gesto?: ClassificacaoGesto;
}

/** Resultado do reconhecedor de maos/gestos para um frame. */
export interface ResultadoMaos {
  maos: MaoDetectada[];
  modelo?: string;
}

/** Qualquer subsistema pode falhar sem apagar os demais. */
export type ResultadoOuIndisponivel<T> = T | ResultadoIndisponivel;
