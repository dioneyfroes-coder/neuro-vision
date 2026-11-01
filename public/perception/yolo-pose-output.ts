/**
 * Interpretacao da saida do YOLO Pose (output0) — funcao pura (P2.4).
 *
 * O modelo `Xenova/yolov8*-pose` devolve `output0` com shape `[1, 56, 8400]`.
 * Depois de `output0[0].transpose(1, 0).tolist()`, cada linha tem 56 numeros:
 * 4 da caixa, 1 score da pessoa e 17 keypoints COCO em triplas
 * `(x, y, visibilidade)`. As coordenadas estao no espaco da imagem de entrada
 * (ex.: 640x640) e precisam ser escaladas para a imagem original.
 *
 * Este modulo e **puro e sem SDK**: permite testar o parser contra uma amostra
 * real de tensor versionada, sem carregar Transformers.js/ONNX no CI.
 */

/** Dimensoes em pixels (entrada do modelo ou imagem original). */
export interface DimensoesPixels {
  largura: number;
  altura: number;
}

export interface KeypointYoloPose {
  x: number;
  y: number;
  confianca?: number;
}

export interface PessoaYoloPose {
  keypoints: KeypointYoloPose[];
  confianca?: number;
}

export interface ResultadoInterpretacaoPose {
  pessoas: PessoaYoloPose[];
}

/** Confianca minima para manter uma pessoa (model card do YOLO Pose). */
export const LIMIAR_SCORE_POSE = 0.3;

/** Indice da primeira coordenada de keypoint apos caixa (4) + score (1). */
export const OFFSET_KEYPOINTS_YOLO_POSE = 5;

/** Cada keypoint ocupa (x, y, visibilidade). */
export const PASSO_KEYPOINT_YOLO_POSE = 3;

/** Quantidade de keypoints COCO esperada por pessoa. */
export const KEYPOINTS_POR_PESSOA = 17;

function dimensao(valor: number | undefined): number {
  return Number.isFinite(valor) && (valor as number) > 0 ? (valor as number) : 1;
}

/**
 * Converte as linhas ja transpostas do `output0` em pessoas com keypoints na
 * resolucao original.
 *
 * - linhas com score abaixo de `limiarScore` sao descartadas;
 * - keypoints incompletos no fim da linha nao sao inventados (o laco para);
 * - dimensoes de entrada invalidas caem para 1, evitando divisao por zero.
 */
export function interpretarLinhasYoloPose(
  linhas: readonly (readonly number[])[],
  dimensoesEntrada: DimensoesPixels,
  dimensoesOriginais: DimensoesPixels,
  limiarScore: number = LIMIAR_SCORE_POSE
): ResultadoInterpretacaoPose {
  const larguraEntrada = dimensao(dimensoesEntrada.largura);
  const alturaEntrada = dimensao(dimensoesEntrada.altura);
  const escalaX = dimensao(dimensoesOriginais.largura) / larguraEntrada;
  const escalaY = dimensao(dimensoesOriginais.altura) / alturaEntrada;

  const pessoas: PessoaYoloPose[] = [];
  for (const linha of linhas) {
    const score = linha[4] ?? 0;
    if (score < limiarScore) continue;

    const keypoints: KeypointYoloPose[] = [];
    for (
      let i = OFFSET_KEYPOINTS_YOLO_POSE;
      i + 2 < linha.length;
      i += PASSO_KEYPOINT_YOLO_POSE
    ) {
      keypoints.push({
        x: (linha[i] ?? 0) * escalaX,
        y: (linha[i + 1] ?? 0) * escalaY,
        confianca: linha[i + 2],
      });
    }
    pessoas.push({ keypoints, confianca: score });
  }
  return { pessoas };
}
