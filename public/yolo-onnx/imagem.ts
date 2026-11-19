import { ErroPercepcao } from "../../src/erros";
import {
  COCO_INGLES,
  LADO_ENTRADA_YOLO,
  type DeteccaoYOLO,
} from "./tipos";

/** RGBA (canvas 640x640) -> tensor float32 NCHW [1, 3, lado, lado] em [0, 1]. */
export function rgbaParaTensorNCHW(
  rgba: Uint8ClampedArray,
  lado: number = LADO_ENTRADA_YOLO
): Float32Array {
  const plano = lado * lado;
  const dados = new Float32Array(3 * plano);
  for (let i = 0; i < plano; i++) {
    dados[i] = rgba[i * 4] / 255;
    dados[plano + i] = rgba[i * 4 + 1] / 255;
    dados[2 * plano + i] = rgba[i * 4 + 2] / 255;
  }
  return dados;
}

/**
 * Interpreta a saida do YOLOv10/v11 (`[1, 300, 6]`, NMS-free) e devolve caixas
 * na resolucao original. Aceita tambem a forma transposta `[1, 6, 300]`, caso
 * o export do modelo mude. `rotulos` permite reaproveitar o mesmo interpretador
 * para modelos fora do COCO (ex.: o detector NSFW experimental); a ordem
 * corresponde aos ids de classe do modelo exportado.
 */
export function interpretarSaidaYolo(
  cru: Float32Array,
  dims: number[],
  limiar: number,
  larguraOriginal: number,
  alturaOriginal: number,
  lado: number = LADO_ENTRADA_YOLO,
  rotulos: readonly string[] = COCO_INGLES
): DeteccaoYOLO[] {
  if (dims.length < 2) {
    throw new ErroPercepcao("detector", `Saida inesperada do YOLO: dims=${dims.join("x")}.`);
  }
  const transposto = dims[1] === 6;
  const colunas = transposto ? 6 : dims[dims.length - 1];
  const linhas = transposto ? dims[dims.length - 1] : dims[dims.length - 2];
  if (colunas < 6) {
    throw new ErroPercepcao("detector", `Saida inesperada do YOLO: dims=${dims.join("x")}.`);
  }
  const indice = (linha: number, coluna: number) =>
    transposto ? coluna * linhas + linha : linha * colunas + coluna;

  const ex = larguraOriginal / lado;
  const ey = alturaOriginal / lado;
  const deteccoes: DeteccaoYOLO[] = [];
  for (let i = 0; i < linhas; i++) {
    const score = cru[indice(i, 4)];
    if (!(score >= limiar)) continue;
    const classe = Math.round(cru[indice(i, 5)]);
    const xmin = Math.max(0, Math.min(larguraOriginal, cru[indice(i, 0)] * ex));
    const ymin = Math.max(0, Math.min(alturaOriginal, cru[indice(i, 1)] * ey));
    const xmax = Math.max(0, Math.min(larguraOriginal, cru[indice(i, 2)] * ex));
    const ymax = Math.max(0, Math.min(alturaOriginal, cru[indice(i, 3)] * ey));
    if (xmax <= xmin || ymax <= ymin) continue;
    deteccoes.push({
      label: rotulos[classe] ?? `classe ${classe}`,
      score,
      box: { xmin, ymin, xmax, ymax },
    });
  }
  return deteccoes;
}

/** Decodifica uma imagem em data URL/base64 num bitmap do navegador. */
export async function decodificarImagem(dataUrl: string): Promise<ImageBitmap> {
  try {
    const resposta = await fetch(dataUrl);
    return await createImageBitmap(await resposta.blob());
  } catch (erro) {
    throw new ErroPercepcao("detector", `Nao foi possivel decodificar o frame (${String(erro)}).`, {
      cause: erro,
    });
  }
}

/** Redimensiona (stretch) o bitmap para o lado de entrada e extrai os pixels. */
export function rasterizar(bitmap: ImageBitmap, lado: number): Uint8ClampedArray {
  const canvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(lado, lado)
      : Object.assign(document.createElement("canvas"), { width: lado, height: lado });
  const contexto = canvas.getContext("2d", { willReadFrequently: true });
  if (!contexto) throw new ErroPercepcao("detector", "Canvas 2D indisponivel para o YOLO.");
  contexto.drawImage(bitmap, 0, 0, lado, lado);
  return contexto.getImageData(0, 0, lado, lado).data;
}
