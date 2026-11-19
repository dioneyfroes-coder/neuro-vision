import { indisponivel } from "../../src/domain";
import type { ObservacaoFrame, PessoaPose, PontoCorporal } from "../../src/domain";
import { MotorTemporalImpl } from "../../public/temporal/motor-temporal";

// ---------------------------------------------------------------------------
// Helpers deterministicos
// ---------------------------------------------------------------------------

let contador = 0;

export function reiniciarContador() {
  contador = 0;
}

export interface OpcoesObs {
  ms: number;
  deteccoes?: ObservacaoFrame["deteccoes"];
  pose?: ObservacaoFrame["pose"];
  maos?: ObservacaoFrame["maos"];
  assinaturaCena?: number[];
  cycleId?: string;
}

export function obs(o: OpcoesObs): ObservacaoFrame {
  contador += 1;
  return {
    sessionId: "s1",
    cycleId: o.cycleId ?? "s1-c1",
    frameId: `f${contador}`,
    capturadoEm: new Date(1700000000000 + o.ms).toISOString(),
    capturadoEmMs: o.ms,
    imagem: "data:,",
    assinaturaCena: o.assinaturaCena,
    deteccoes: o.deteccoes ?? indisponivel("deteccao", "desativado"),
    pose: o.pose ?? indisponivel("pose", "desativado"),
    maos: o.maos ?? indisponivel("maos", "desativado"),
    metricas: {},
  };
}

/** Pose COCO (17 pontos) com os punhos em alturas configuraveis. */
export function posePessoa(
  punhoEsqY?: number,
  punhoDirY?: number,
  deslocamentoX = 0
): ObservacaoFrame["pose"] {
  const pontos: PontoCorporal[] = Array.from({ length: 17 }, () => ({
    x: 0.5 + deslocamentoX,
    y: 0.6,
    confianca: 0.9,
  }));
  if (punhoEsqY !== undefined) {
    pontos[9] = { x: 0.4 + deslocamentoX, y: punhoEsqY, confianca: 0.9 };
  }
  if (punhoDirY !== undefined) {
    pontos[10] = { x: 0.6 + deslocamentoX, y: punhoDirY, confianca: 0.9 };
  }
  return { pessoas: [{ pontos, confianca: 0.9 } as PessoaPose] };
}

export function maoComGesto(
  nome: string,
  confianca = 0.9,
  x = 0.5
): ObservacaoFrame["maos"] {
  return {
    maos: [
      {
        lateralidade: "direita",
        landmarks: [
          { x, y: 0.4 },
          { x: x + 0.02, y: 0.38 },
        ],
        gesto: { nome, confianca },
      },
    ],
  };
}

/** 21 landmarks com todos os dedos estendidos (mao aberta geometrica). */
export function landmarksMaoAberta(): NonNullable<ObservacaoFrame["maos"]>["maos"][number]["landmarks"] {
  const landmarks: PontoCorporal[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }));
  landmarks[0] = { x: 0.5, y: 0.9 };
  landmarks[1] = { x: 0.4, y: 0.75 };
  landmarks[2] = { x: 0.35, y: 0.65 };
  landmarks[3] = { x: 0.3, y: 0.55 };
  landmarks[4] = { x: 0.25, y: 0.45 };
  const dedos = [
    { mcp: 5, pip: 6, dip: 7, tip: 8, x: 0.38 },
    { mcp: 9, pip: 10, dip: 11, tip: 12, x: 0.46 },
    { mcp: 13, pip: 14, dip: 15, tip: 16, x: 0.54 },
    { mcp: 17, pip: 18, dip: 19, tip: 20, x: 0.62 },
  ];
  for (const { mcp, pip, dip, tip, x } of dedos) {
    landmarks[mcp] = { x, y: 0.6 };
    landmarks[pip] = { x, y: 0.48 };
    landmarks[dip] = { x, y: 0.36 };
    landmarks[tip] = { x, y: 0.24 };
  }
  return landmarks;
}

export function maoGeometrica(
  lateralidade: "esquerda" | "direita" = "direita",
  x = 0.5
): NonNullable<ObservacaoFrame["maos"]>["maos"][number] {
  return {
    lateralidade,
    landmarks: landmarksMaoAberta().map((ponto) => ({ ...ponto, x: ponto.x + (x - 0.5) })),
  };
}

/**
 * Indicador com angulo proximal de 140 graus em coordenadas normalizadas. Em
 * 16:9 o angulo real passa de 150 e o dedo deve contar como estendido; sem as
 * dimensoes, a geometria o trata como dobrado (4 dedos estendidos).
 */
export function maoIndicadorCurvo(): NonNullable<ObservacaoFrame["maos"]>["maos"][number] {
  const mao = maoGeometrica();
  const direcao = Math.PI - (140 * Math.PI) / 180;
  const passo = 0.1;
  const dx = passo * Math.cos(direcao);
  const dy = passo * Math.sin(direcao);
  mao.landmarks[5] = { x: 0.4, y: 0.5 };
  mao.landmarks[6] = { x: 0.5, y: 0.5 };
  mao.landmarks[7] = { x: 0.5 + dx, y: 0.5 + dy };
  mao.landmarks[8] = { x: 0.5 + 2 * dx, y: 0.5 + 2 * dy };
  return mao;
}

export function criarMotor() {
  return new MotorTemporalImpl({
    rastreador: { distanciaMaxima: 0.3, maxFramesAusente: 3, alphaSuavizacao: 0.5 },
    gestos: { framesParaConfirmar: 2, framesParaEncerrar: 2, confiancaMinima: 0.5 },
    braco: { framesParaConfirmar: 2, framesParaEncerrar: 2, confiancaMinima: 0.5 },
    limiarAlturaBraco: 0.4,
  });
}