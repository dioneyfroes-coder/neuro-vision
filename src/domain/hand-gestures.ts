import type { LandmarkMao } from "./perception";
import {
  resumirGeometria,
  type EstadoDedo,
  type GeometriaDedo,
  type GeometriaMao,
  type NomeDedo,
} from "./hand-geometry";

/**
 * Regras geometricas iniciais de gestos (P2.4) e histerese por dedo (P2.5).
 *
 * O classificador do MediaPipe continua sendo uma evidencia; estas regras sao
 * uma segunda opiniao derivada dos 21 landmarks. Elas **nao** substituem o
 * modelo nem viram certeza: quando a geometria e o rotulo discordam, a
 * confianca e reduzida e o conflito fica registrado em `evidencias`.
 */

/** Gestos cobertos pelas regras iniciais. */
export type NomeGestoGeometrico =
  | "polegar_para_cima"
  | "mao_aberta"
  | "punho_fechado"
  | "um_dedo"
  | "dois_dedos";

/** Resultado da classificacao geometrica (nunca uma certeza). */
export interface ClassificacaoGestoGeometrico {
  /** `null` quando a geometria nao sustenta uma das regras iniciais. */
  nome: NomeGestoGeometrico | null;
  /** Confianca heuristica em [0,0.9]; nunca 1. */
  confianca: number;
  totalEstendidos: number;
  totalDedosConhecidos: number;
  dedosEstendidos: NomeDedo[];
  dedosDesconhecidos: NomeDedo[];
  evidencias: string[];
}

/** Estado de cada dedo, usado para histerese entre frames. */
export type EstadoDedos = Readonly<Partial<Record<NomeDedo, EstadoDedo>>>;

const GESTOS_CANONICOS: Readonly<Record<string, NomeGestoGeometrico | null>> = {
  polegar_para_cima: "polegar_para_cima",
  mao_aberta: "mao_aberta",
  punho_fechado: "punho_fechado",
  um_dedo: "um_dedo",
  dois_dedos: "dois_dedos",
  // Rotulos do MediaPipe que descrevem a mesma configuracao geometrica.
  apontando_para_cima: "um_dedo",
  vitoria: "dois_dedos",
  // Rotulos sem equivalente nas regras iniciais.
  nenhum: null,
  polegar_para_baixo: null,
  amo_voce: null,
};

/** Normaliza um rotulo (do modelo ou geometrico) para as regras iniciais. */
export function canonizarGesto(nome: string | null | undefined): NomeGestoGeometrico | null {
  if (!nome) return null;
  return GESTOS_CANONICOS[nome] ?? null;
}

/**
 * Aplica histerese angular por dedo.
 *
 * Para continuar estendido, o dedo pode cair ate `limiar - histerese`; para
 * entrar em estendido, precisa alcancar o limiar cheio. Isso evita cintilacao
 * quando o angulo fica na fronteira, sem inventar estado para dedos
 * desconhecidos.
 */
export function estabilizarDedos(
  geometria: GeometriaMao,
  anterior?: EstadoDedos,
  histereseGraus = 10
): GeometriaMao {
  const histerese = Math.max(0, histereseGraus);
  const limiarEntrada = geometria.limiarExtensaoGraus;
  const limiarPermanencia = Math.max(0, limiarEntrada - histerese);

  const dedos: GeometriaDedo[] = geometria.dedos.map((dedo) => {
    if (dedo.estado === "desconhecido" || dedo.angulos.length === 0) {
      return { ...dedo, angulos: [...dedo.angulos], estendido: false, estado: "desconhecido" };
    }
    const limiar = anterior?.[dedo.nome] === "estendido" ? limiarPermanencia : limiarEntrada;
    const estendido = dedo.angulos.every((angulo) => angulo >= limiar);
    return {
      ...dedo,
      angulos: [...dedo.angulos],
      estendido,
      estado: estendido ? "estendido" : "dobrado",
    };
  });

  return resumirGeometria(dedos, limiarEntrada);
}

/** Extrai o estado conhecido de cada dedo para alimentar a proxima histerese. */
export function estadosDosDedos(geometria: GeometriaMao): Record<NomeDedo, EstadoDedo> {
  return geometria.dedos.reduce(
    (estados, dedo) => {
      estados[dedo.nome] = dedo.estado;
      return estados;
    },
    {} as Record<NomeDedo, EstadoDedo>
  );
}

/** Confianca heuristica: base pela fração de dedos conhecidos, limitada a 0.9. */
function confiancaGeometrica(geometria: GeometriaMao): number {
  const conhecidos = geometria.totalDedosConhecidos;
  const base = 0.5 + 0.35 * (conhecidos / 5);
  return Math.min(0.9, Math.round(base * 100) / 100);
}

/** Polegar apontando para cima (topo da imagem = y menor). */
function polegarParaCima(landmarks: readonly LandmarkMao[] | undefined): boolean {
  if (!landmarks) return false;
  const punho = landmarks[0];
  const mcp = landmarks[2];
  const ip = landmarks[3];
  const ponta = landmarks[4];
  if (!punho || !mcp || !ip || !ponta) return false;
  for (const ponto of [punho, mcp, ip, ponta]) {
    if (!Number.isFinite(ponto.x) || !Number.isFinite(ponto.y)) return false;
  }
  return ponta.y < ip.y && ip.y < mcp.y && ponta.y < punho.y;
}

/**
 * Classifica a mao pelas regras iniciais.
 *
 * A ordem importa: polegar para cima vem antes de "um dedo" porque compartilha
 * a contagem (1 dedo estendido), mas exige orientacao vertical do polegar.
 */
export function classificarGestoGeometrico(
  geometria: GeometriaMao | null,
  landmarks?: readonly LandmarkMao[]
): ClassificacaoGestoGeometrico {
  if (!geometria) {
    return {
      nome: null,
      confianca: 0,
      totalEstendidos: 0,
      totalDedosConhecidos: 0,
      dedosEstendidos: [],
      dedosDesconhecidos: [],
      evidencias: ["geometria:indisponivel"],
    };
  }

  const confianca = confiancaGeometrica(geometria);
  const evidencias = [
    `geometria:${geometria.configuracao}`,
    `dedos:${geometria.totalEstendidos}/${geometria.totalDedosConhecidos}`,
  ];
  const base = {
    totalEstendidos: geometria.totalEstendidos,
    totalDedosConhecidos: geometria.totalDedosConhecidos,
    dedosEstendidos: [...geometria.dedosEstendidos],
    dedosDesconhecidos: [...geometria.dedosDesconhecidos],
  };

  const somentePolegar =
    geometria.totalEstendidos === 1 && geometria.dedosEstendidos[0] === "polegar";
  if (somentePolegar && polegarParaCima(landmarks)) {
    return {
      ...base,
      nome: "polegar_para_cima",
      confianca: Math.min(0.9, confianca + 0.05),
      evidencias: [...evidencias, "polegar:vertical"],
    };
  }

  if (geometria.totalEstendidos === 5) {
    return { ...base, nome: "mao_aberta", confianca, evidencias };
  }

  // Punho exige os cinco dedos conhecidos: mao parcial nao vira "fechada".
  if (geometria.totalEstendidos === 0 && geometria.totalDedosConhecidos === 5) {
    return { ...base, nome: "punho_fechado", confianca, evidencias };
  }

  if (geometria.totalEstendidos === 1) {
    return { ...base, nome: "um_dedo", confianca, evidencias };
  }

  if (geometria.totalEstendidos === 2) {
    return { ...base, nome: "dois_dedos", confianca, evidencias };
  }

  return { ...base, nome: null, confianca: 0, evidencias };
}

/**
 * Combina o rotulo do modelo com a classificacao geometrica.
 *
 * - concordancia: preserva ambos como evidencia e soma um pequeno bonus;
 * - discordancia: reduz a confianca (heuristica nao vira certeza) e registra o
 *   conflito explicitamente;
 * - apenas um dos dois: usa-o, sempre com confianca limitada.
 */
export function combinarGesto(
  rotuloModelo: string | null | undefined,
  confiancaModelo: number,
  geometrico: ClassificacaoGestoGeometrico
): { rotulo: string | null; confianca: number; evidencias: string[] } {
  const modelo = rotuloModelo ? rotuloModelo : null;
  const confiancaModeloNormalizada =
    Number.isFinite(confiancaModelo) && confiancaModelo > 0 ? Math.min(1, confiancaModelo) : 0;
  const canonicoModelo = canonizarGesto(modelo);
  const canonicoGeometrico = geometrico.nome;

  if (modelo && canonicoModelo && canonicoGeometrico) {
    if (canonicoModelo === canonicoGeometrico) {
      return {
        rotulo: modelo,
        confianca: Math.min(0.95, Math.max(confiancaModeloNormalizada, geometrico.confianca) + 0.05),
        evidencias: [...geometrico.evidencias, `mediapipe:${modelo}`],
      };
    }
    return {
      rotulo:
        confiancaModeloNormalizada >= geometrico.confianca ? modelo : geometrico.nome,
      // Discordancia: nao tratar nenhuma das fontes como certa.
      confianca: Math.max(0.1, Math.max(confiancaModeloNormalizada, geometrico.confianca) * 0.8),
      evidencias: [
        ...geometrico.evidencias,
        `mediapipe:${modelo}`,
        `conflito:modelo=${canonicoModelo ?? "?"},geometria=${canonicoGeometrico}`,
      ],
    };
  }

  if (modelo && confiancaModeloNormalizada > 0) {
    return {
      rotulo: modelo,
      confianca: Math.min(0.95, confiancaModeloNormalizada),
      evidencias: [...geometrico.evidencias, `mediapipe:${modelo}`],
    };
  }

  if (geometrico.nome) {
    return {
      rotulo: geometrico.nome,
      confianca: geometrico.confianca,
      evidencias: [...geometrico.evidencias, `fonte:geometria`],
    };
  }

  return { rotulo: null, confianca: 0, evidencias: geometrico.evidencias };
}
