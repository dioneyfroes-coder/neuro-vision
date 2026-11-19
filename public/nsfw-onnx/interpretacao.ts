import { ErroPercepcao } from "../../src/erros";
import type { DeteccaoYOLO } from "../yolo-onnx";
import { CLASSES_NUDENET, LIMIARES_NSFW } from "./catalogo";

/**
 * Carrega os rotulos do sidecar `<url>.onnx.json` gravado pelo export/baixador.
 * Devolve `null` quando o sidecar nao existe (rotulos viram `classe N`).
 */
export async function carregarRotulosNsfw(urlModelo: string): Promise<string[] | null> {
  try {
    const resposta = await fetch(`${urlModelo}.json`);
    if (!resposta.ok) return null;
    const dados = (await resposta.json()) as { classes?: unknown };
    const classes = dados.classes;
    if (Array.isArray(classes)) return classes.map(String);
    if (classes && typeof classes === "object") {
      const mapa = classes as Record<string, unknown>;
      const indices = Object.keys(mapa)
        .map(Number)
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => a - b);
      if (indices.length > 0) return indices.map((n) => String(mapa[n]));
    }
    return null;
  } catch {
    return null;
  }
}

function iou(a: DeteccaoYOLO, b: DeteccaoYOLO): number {
  const x1 = Math.max(a.box.xmin, b.box.xmin);
  const y1 = Math.max(a.box.ymin, b.box.ymin);
  const x2 = Math.min(a.box.xmax, b.box.xmax);
  const y2 = Math.min(a.box.ymax, b.box.ymax);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = Math.max(0, a.box.xmax - a.box.xmin) * Math.max(0, a.box.ymax - a.box.ymin);
  const areaB = Math.max(0, b.box.xmax - b.box.xmin) * Math.max(0, b.box.ymax - b.box.ymin);
  return inter / (areaA + areaB - inter + 1e-9);
}

/** NMS por rotulo (classes diferentes nao se suprimem). */
export function nmsPorRotulo(
  deteccoes: ReadonlyArray<DeteccaoYOLO>,
  iouLimite = 0.45
): DeteccaoYOLO[] {
  const porRotulo = new Map<string, DeteccaoYOLO[]>();
  for (const d of deteccoes) {
    const lista = porRotulo.get(d.label) ?? [];
    lista.push(d);
    porRotulo.set(d.label, lista);
  }
  const saida: DeteccaoYOLO[] = [];
  for (const lista of porRotulo.values()) {
    const ordenada = [...lista].sort((a, b) => b.score - a.score);
    const mantidas: DeteccaoYOLO[] = [];
    for (const candidata of ordenada) {
      if (mantidas.every((m) => iou(candidata, m) <= iouLimite)) mantidas.push(candidata);
    }
    saida.push(...mantidas);
  }
  return saida.sort((a, b) => b.score - a.score);
}

function sigmoid(valor: number): number {
  return 1 / (1 + Math.exp(-valor));
}

/**
 * Tolerancia para considerar um score "fora de [0,1]".
 *
 * Probabilidades em float32 podem sair levemente negativas (ex.: -6e-8). Sem
 * tolerancia, uma unica linha assim dispara o sigmoid e `sigmoid(0) = 0,5`
 * transforma classes ausentes (`FACE_MALE`, `MALE_BREAST_EXPOSED`) em falsos
 * positivos com score 0,5.
 */
const TOLERANCIA_PROBABILIDADE = 1e-3;

/**
 * Decide se a saida crua traz **logits** (precisa de sigmoid) em vez de
 * probabilidades. A decisao e do tensor inteiro, nao de cada linha: assim um
 * residuo numerico isolado nao muda a escala do resto.
 */
function saidaCruaUsaLogits(
  cru: Float32Array,
  linhas: number,
  indice: (linha: number, coluna: number) => number
): boolean {
  for (let i = 0; i < linhas; i += 1) {
    for (let c = 0; c < 18; c += 1) {
      const valor = cru[indice(i, 4 + c)];
      if (!Number.isFinite(valor)) continue;
      if (valor < -TOLERANCIA_PROBABILIDADE || valor > 1 + TOLERANCIA_PROBABILIDADE) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Interpreta a saida crua do YOLOv8/NudeNet (`[1, 22, N]`): 4 coordenadas
 * `cx,cy,w,h` + 18 scores de classe. Aceita a forma transposta `[1, N, 22]`.
 *
 * Aplica sigmoid quando os scores nao estao em [0,1], filtra pelo limiar
 * efetivo de cada rotulo e aplica NMS por classe. As caixas saem em pixels da
 * imagem original.
 */
export function interpretarSaidaNudeNetCru(
  cru: Float32Array,
  dims: number[],
  limiarGlobal: number,
  larguraOriginal: number,
  alturaOriginal: number,
  lado: number,
  rotulos: readonly string[] = CLASSES_NUDENET,
  limiares: Readonly<Record<string, number>> = LIMIARES_NSFW
): DeteccaoYOLO[] {
  if (dims.length < 2) {
    throw new ErroPercepcao("detector", `Saida inesperada do NudeNet: dims=${dims.join("x")}.`);
  }
  const transposto = dims[1] === 22;
  const colunas = 22;
  const linhas = transposto ? dims[dims.length - 1] : dims[dims.length - 2];
  if (!Number.isFinite(linhas) || linhas <= 0) {
    throw new ErroPercepcao("detector", `Saida inesperada do NudeNet: dims=${dims.join("x")}.`);
  }
  const indice = (linha: number, coluna: number) =>
    transposto ? coluna * linhas + linha : linha * colunas + coluna;

  const ex = larguraOriginal / lado;
  const ey = alturaOriginal / lado;
  const candidatas: DeteccaoYOLO[] = [];
  const usaLogits = saidaCruaUsaLogits(cru, linhas, indice);

  for (let i = 0; i < linhas; i += 1) {
    const scores = new Array<number>(18);
    for (let c = 0; c < 18; c += 1) {
      const valor = cru[indice(i, 4 + c)];
      scores[c] = usaLogits ? sigmoid(valor) : valor;
    }
    let melhor = 0;
    let score = scores[0];
    for (let c = 1; c < 18; c += 1) {
      if (scores[c] > score) {
        score = scores[c];
        melhor = c;
      }
    }
    if (!Number.isFinite(score)) continue;
    score = Math.min(1, Math.max(0, score));
    const rotulo = rotulos[melhor] ?? `classe ${melhor}`;
    const limiar = limiares[rotulo] ?? limiarGlobal;
    if (!(score >= limiar)) continue;

    const cx = cru[indice(i, 0)];
    const cy = cru[indice(i, 1)];
    const largura = cru[indice(i, 2)];
    const altura = cru[indice(i, 3)];
    const xmin = Math.max(0, Math.min(larguraOriginal, (cx - largura / 2) * ex));
    const ymin = Math.max(0, Math.min(alturaOriginal, (cy - altura / 2) * ey));
    const xmax = Math.max(0, Math.min(larguraOriginal, (cx + largura / 2) * ex));
    const ymax = Math.max(0, Math.min(alturaOriginal, (cy + altura / 2) * ey));
    if (xmax <= xmin || ymax <= ymin) continue;

    candidatas.push({ label: rotulo, score, box: { xmin, ymin, xmax, ymax } });
  }

  return nmsPorRotulo(candidatas);
}

/** Filtra deteccoes de saida NMS pelo limiar efetivo de cada rotulo. */
export function filtrarDeteccoesNsfw(
  deteccoes: ReadonlyArray<DeteccaoYOLO>,
  limiarGlobal = 0.5,
  limiares: Readonly<Record<string, number>> = LIMIARES_NSFW
): DeteccaoYOLO[] {
  return deteccoes.filter((d) => d.score >= (limiares[d.label] ?? limiarGlobal));
}

/**
 * Classes do NudeNet que **nao** descrevem conteudo adulto: rosto, pes, barriga
 * e axila. Elas saem na saida crua e, sem filtro, inundariam o prompt NSFW com
 * marcacoes irrelevantes (`FACE_FEMALE` em 12/12 frames, por exemplo).
 *
 * Rotulos fora desta lista e do catalogo sao preservados: um modelo customizado
 * sem sidecar continua funcionando.
 */
export const CLASSES_NSFW_IGNORADAS: ReadonlySet<string> = new Set([
  "FACE_FEMALE",
  "FACE_MALE",
  "FEET_EXPOSED",
  "FEET_COVERED",
  "BELLY_COVERED",
  "BELLY_EXPOSED",
  "ARMPITS_COVERED",
  "ARMPITS_EXPOSED",
]);

/** Remove marcacoes nao sensiveis (rosto, pes, barriga, axila). */
export function filtrarClassesNsfwRelevantes(
  deteccoes: ReadonlyArray<DeteccaoYOLO>
): DeteccaoYOLO[] {
  return deteccoes.filter((d) => !CLASSES_NSFW_IGNORADAS.has(d.label));
}
