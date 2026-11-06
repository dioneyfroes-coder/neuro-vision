import type { LandmarkMao } from "./perception";

/**
 * Geometria da mao derivada dos 21 landmarks do MediaPipe (P2.1).
 *
 * O Gesture Recognizer so devolve um conjunto fechado de classes
 * (`Closed_Fist`, `Open_Palm`, `Pointing_Up`, ...). Para permitir que o modelo
 * multimodal (e um futuro classificador customizado) raciocine sobre
 * configuracoes fora dessas classes — dedos seletivamente erguidos, mao
 * parcialmente fechada, etc. — derivamos aqui **features geometricas
 * interpretaveis**: o angulo interno de cada articulacao e um estado
 * estendido/dobrado por dedo.
 *
 * Regras:
 * - a heuristica de extensao usa os angulos proximais/distais do dedo, nao o
 *   rotulo do classificador;
 * - coordenadas sao normalizadas [0, 1]; a anisotropia da imagem (largura x
 *   altura) pode distorcer levemente os angulos, por isso o resultado e uma
 *   aproximacao, nao uma medida clinica;
 * - pontos ausentes/invalidos nao inventam geometria: o dedo fica de fora.
 */

/** Nome anatomico dos dedos, na ordem do polegar ao mindinho. */
export type NomeDedo = "polegar" | "indicador" | "medio" | "anular" | "mindinho";

/**
 * Estado estavel de um dedo.
 *
 * `desconhecido` e explicito: landmarks ausentes/invalidos nao podem virar
 * "dobrado" nem "estendido". A representacao mantem sempre os cinco dedos na
 * ordem anatomica, com estado desconhecido onde falta evidencia.
 */
export type EstadoDedo = "estendido" | "dobrado" | "desconhecido";

/** Angulos e estado de um dedo. */
export interface GeometriaDedo {
  nome: NomeDedo;
  /** Angulos internos (graus) da articulacao proximal para a distal. */
  angulos: number[];
  /** Heuristica: todos os angulos do dedo acima do limiar de extensao. */
  estendido: boolean;
  /** Estado estavel (estendido, dobrado ou desconhecido). */
  estado: EstadoDedo;
}

/** Geometria resumida de uma mao. */
export interface GeometriaMao {
  /** Sempre os cinco dedos, na ordem anatomica (polegar..minimo). */
  dedos: GeometriaDedo[];
  /** Dedos conhecidos e estendidos, na ordem anatomica. */
  dedosEstendidos: NomeDedo[];
  /** Dedos conhecidos e dobrados, na ordem anatomica. */
  dedosDobrados: NomeDedo[];
  /** Dedos sem evidencia suficiente neste frame. */
  dedosDesconhecidos: NomeDedo[];
  /** Quantidade de dedos estendidos (0..5). */
  totalEstendidos: number;
  /** Quantidade de dedos com estado conhecido (0..5). */
  totalDedosConhecidos: number;
  /** Configuracao compacta: `todos`, `nenhum` ou nomes unidos por `+`. */
  configuracao: string;
  /** Limiar (graus) usado na heuristica de extensao. */
  limiarExtensaoGraus: number;
}

/** Opcoes de calculo da geometria. */
export interface OpcoesGeometriaMao {
  /**
   * Angulo interno minimo (graus) para considerar o dedo estendido. Dedos
   * retos ficam proximos de 180; dobrados, abaixo de ~120. Padrao: 150.
   */
  limiarExtensaoGraus?: number;
  /** Casas decimais dos angulos. Padrao: 1. */
  decimais?: number;
}

/** Limiar padrao de extensao (graus). */
export const LIMIAR_EXTENSAO_PADRAO_GRAUS = 150;

/** Total de dedos de uma mao completa (usado no resumo `todos`). */
const TOTAL_DEDOS = 5;

/**
 * Triplas de landmarks que definem o angulo interno de cada dedo.
 *
 * Indices do MediaPipe Hands: 0 punho; polegar 1-4; indicador 5-8; medio 9-12;
 * anular 13-16; mindinho 17-20. Cada tripla `[a, b, c]` mede o angulo em `b`.
 */
const ARTICULACOES_DEDOS: ReadonlyArray<{
  nome: NomeDedo;
  articulacoes: ReadonlyArray<readonly [number, number, number]>;
}> = [
  { nome: "polegar", articulacoes: [[1, 2, 3], [2, 3, 4]] },
  { nome: "indicador", articulacoes: [[5, 6, 7], [6, 7, 8]] },
  { nome: "medio", articulacoes: [[9, 10, 11], [10, 11, 12]] },
  { nome: "anular", articulacoes: [[13, 14, 15], [14, 15, 16]] },
  { nome: "mindinho", articulacoes: [[17, 18, 19], [18, 19, 20]] },
];

/**
 * Angulo interno (graus) no vertice `b` do triangulo `a-b-c`.
 *
 * Retorna `null` quando algum vetor tem comprimento zero (pontos coincidentes),
 * para nao transformar ausencia de informacao em um angulo arbitrario.
 */
export function anguloInterno(
  a: Pick<LandmarkMao, "x" | "y">,
  b: Pick<LandmarkMao, "x" | "y">,
  c: Pick<LandmarkMao, "x" | "y">
): number | null {
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const n1 = Math.hypot(v1x, v1y);
  const n2 = Math.hypot(v2x, v2y);
  if (n1 === 0 || n2 === 0) return null;
  const cosseno = Math.min(1, Math.max(-1, (v1x * v2x + v1y * v2y) / (n1 * n2)));
  return (Math.acos(cosseno) * 180) / Math.PI;
}

function pontoValido(ponto: LandmarkMao | undefined): ponto is LandmarkMao {
  return (
    ponto !== undefined &&
    Number.isFinite(ponto.x) &&
    Number.isFinite(ponto.y)
  );
}

function arredondar(valor: number, decimais: number): number {
  const fator = 10 ** decimais;
  return Math.round(valor * fator) / fator;
}

/**
 * Calcula angulos e estado estendido/dobrado de cada dedo.
 *
 * Retorna `null` quando nao ha landmarks suficientes para nenhum dedo (ex.:
 * resultado vazio). Dedos com pontos invalidos entram na lista com
 * `estado: "desconhecido"`: a mao mantem a representacao estavel dos cinco
 * dedos, mas nao inventa extensao/dobra onde falta evidencia.
 */
export function calcularGeometriaMao(
  landmarks: readonly LandmarkMao[],
  opcoes: OpcoesGeometriaMao = {}
): GeometriaMao | null {
  const limiar = opcoes.limiarExtensaoGraus ?? LIMIAR_EXTENSAO_PADRAO_GRAUS;
  const decimais = opcoes.decimais ?? 1;
  const dedos: GeometriaDedo[] = [];

  for (const { nome, articulacoes } of ARTICULACOES_DEDOS) {
    const angulos: number[] = [];
    let completo = true;
    for (const [ia, ib, ic] of articulacoes) {
      const a = landmarks[ia];
      const b = landmarks[ib];
      const c = landmarks[ic];
      if (!pontoValido(a) || !pontoValido(b) || !pontoValido(c)) {
        completo = false;
        break;
      }
      const angulo = anguloInterno(a, b, c);
      if (angulo === null) {
        completo = false;
        break;
      }
      angulos.push(arredondar(angulo, decimais));
    }
    if (!completo || angulos.length === 0) {
      dedos.push({ nome, angulos: [], estendido: false, estado: "desconhecido" });
      continue;
    }
    const estendido = angulos.every((angulo) => angulo >= limiar);
    dedos.push({
      nome,
      angulos,
      estendido,
      estado: estendido ? "estendido" : "dobrado",
    });
  }

  if (dedos.every((dedo) => dedo.estado === "desconhecido")) return null;
  return resumirGeometria(dedos, limiar);
}

/**
 * Resume uma lista de dedos (na ordem anatomica) em `GeometriaMao`.
 *
 * Exposto para permitir histerese temporal: o motor reavalia o estado de cada
 * dedo com o limiar ajustado e reconstruir o resumo sem duplicar a regra.
 */
export function resumirGeometria(
  dedos: readonly GeometriaDedo[],
  limiarExtensaoGraus: number
): GeometriaMao {
  const dedosEstendidos = dedos.filter((d) => d.estado === "estendido").map((d) => d.nome);
  const dedosDobrados = dedos.filter((d) => d.estado === "dobrado").map((d) => d.nome);
  const dedosDesconhecidos = dedos
    .filter((d) => d.estado === "desconhecido")
    .map((d) => d.nome);
  return {
    dedos: dedos.map((dedo) => ({ ...dedo, angulos: [...dedo.angulos] })),
    dedosEstendidos,
    dedosDobrados,
    dedosDesconhecidos,
    totalEstendidos: dedosEstendidos.length,
    totalDedosConhecidos: dedos.length - dedosDesconhecidos.length,
    // O total e sempre 5 (mao completa): um dedo desconhecido nao pode
    // transformar uma mao parcial em "todos".
    configuracao: configurarDedos(dedosEstendidos, TOTAL_DEDOS),
    limiarExtensaoGraus,
  };
}

/** Resumo legivel da configuracao (todos/nenhum/lista de dedos). */
export function configurarDedos(
  estendidos: readonly NomeDedo[],
  totalDedos = 5
): string {
  if (estendidos.length === 0) return "nenhum";
  if (totalDedos > 0 && estendidos.length === totalDedos) return "todos";
  return estendidos.join("+");
}
