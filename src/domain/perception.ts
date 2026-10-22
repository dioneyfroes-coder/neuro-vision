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
  subsistema: "deteccao" | "pose" | "maos" | "nsfw";
  /** Motivo legivel (erro, timeout, desativado por config). */
  motivo: string;
}

export function indisponivel(
  subsistema: ResultadoIndisponivel["subsistema"],
  motivo: string
): ResultadoIndisponivel {
  return { indisponivel: true, subsistema, motivo };
}

export function estaIndisponivel<T>(
  valor: T | ResultadoIndisponivel | null | undefined
): valor is ResultadoIndisponivel {
  return (
    valor !== null &&
    valor !== undefined &&
    (valor as { indisponivel?: boolean }).indisponivel === true
  );
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
  /**
   * Dimensoes reais da imagem analisada, para normalizar caixas/coordenadas.
   * Opcional: o adaptador pode nao receber as dimensoes do frame (ex.: quando o
   * motor nao as conhece); caixas permanecem em pixels da imagem original.
   */
  dimensoes?: { largura: number; altura: number };
  /** Modelo/motor que produziu o resultado (quando conhecido). */
  modelo?: string;
  /** Resumo legivel (ex.: `2x pessoa, cachorro`), derivado das deteccoes. */
  resumo?: string;
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

/**
 * Marcacao de conteudo sensivel (**NSFW experimental**) em um frame.
 *
 * O subsistema e experimental e desligado por padrao: so roda quando o usuario
 * habilita o toggle da interface e os pesos ONNX existem em `modelos/yolonsfw/`
 * (ver `scripts/exportar-yolo-nsfw.mjs`). Rotulos vem do proprio modelo
 * (ex.: `neutral`, `hentai`, `porn`, `sexy`), sem traducao fixa.
 */
export interface MarcacaoNsfw {
  /** Rotulo devolvido pelo modelo (em ingles, como o modelo classifica). */
  rotulo: string;
  /** Confianca em [0, 1]. */
  score: number;
  caixa: Caixa;
}

/** Resultado do classificador NSFW para um frame. */
export interface ResultadoNsfw {
  marcacoes: MarcacaoNsfw[];
  /** Modelo que produziu o resultado (quando conhecido). */
  modelo?: string;
  /** Resumo legivel (ex.: `porn 0.87, sexy 0.42`). */
  resumo?: string;
}

/** Qualquer subsistema pode falhar sem apagar os demais. */
export type ResultadoOuIndisponivel<T> = T | ResultadoIndisponivel;

/**
 * Estado observado de um subsistema num frame (Fase 2/3).
 *
 * Distingue "rodou e entregou", "rodou sem resultado", "tentou e falhou" e
 * "nao foi carregado" — nunca uma lista vazia indistinguivel. Reproduz a
 * telemetria do adaptador (`MetricasAdaptador`) sem depender do SDK.
 */
export type EstadoSubsistema = "ok" | "sem_resultado" | "indisponivel" | "nao_carregado";

/** Telemetria de um subsistema num frame, pronta para o contexto/registro. */
export interface TelemetriaSubsistema {
  status: EstadoSubsistema;
  /** Modelo em uso, quando conhecido. */
  modelo?: string;
  /** Dispositivo de inferencia (ex.: `wasm`, `gpu`, `cpu`). */
  dispositivo?: string;
  /** Versao do runtime/modelo, quando exposta. */
  versao?: string;
  /** Motivo legivel quando `status === "indisponivel"`. */
  motivoFalha?: string;
}
