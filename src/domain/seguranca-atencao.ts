/**
 * Motor de atenção da segurança (Fase 3).
 *
 * Regras puras: nenhuma função lê relógio, DOM ou rede. O chamador entrega
 * instantes já medidos e sinais observados; a máquina devolve um estado, uma
 * cadência e o motivo da transição. Falha de percepção **congela** o estado —
 * ela nunca é tratada como "cena vazia" ou como estabilidade.
 */
import { intervaloDaCadencia, type CadenciaPercepcao } from "./cadencia";
import type { RegiaoCena } from "./cena";

/** Estados do motor de atenção, em ordem de crescente exigência. */
export type EstadoAtencao =
  | "passivo"
  | "atividade_detectada"
  | "atencao"
  | "interacao"
  | "pos_evento";

export const ESTADOS_ATENCAO: readonly EstadoAtencao[] = [
  "passivo",
  "atividade_detectada",
  "atencao",
  "interacao",
  "pos_evento",
];

export type MotivoTransicaoAtencao =
  | "nenhum"
  | "atividade"
  | "presenca"
  | "interacao"
  | "estabilidade"
  | "retorno_passivo"
  | "percepcao_indisponivel";

export const MOTIVOS_TRANSICAO_ATENCAO: readonly MotivoTransicaoAtencao[] = [
  "nenhum",
  "atividade",
  "presenca",
  "interacao",
  "estabilidade",
  "retorno_passivo",
  "percepcao_indisponivel",
];

export type TipoZonaAtencao = "entrada" | "saida";

/** Retângulo em coordenadas normalizadas [0,1]. Não identifica pessoas. */
export interface ZonaAtencao {
  zonaId: string;
  tipo: TipoZonaAtencao;
  caixa: RegiaoCena;
}

export interface ConfigAtencaoSeguranca {
  /** Amostras com atividade antes de sair de `passivo` (padrão: 1). */
  framesParaAtividade?: number;
  /** Amostras com presença/mudança antes de `atencao` (padrão: 2). */
  framesParaAtencao?: number;
  /** Amostras com interação antes de `interacao` (padrão: 2). */
  framesParaInteracao?: number;
  /** Amostras sem sinal antes de `pos_evento` (padrão: 3). */
  framesParaEstabilidade?: number;
  /** Tempo mínimo sem evidência antes de reduzir (ms; padrão: 5000). */
  manterAposUltimaEvidenciaMs?: number;
  /** Cadência por estado; campos ausentes herdam a tabela padrão. */
  cadencias?: Partial<Record<EstadoAtencao, CadenciaPercepcao>>;
}

/**
 * Intervalos alvo por subsistema e estado. `nsfw` fica ausente de propósito: o
 * conjunto experimental é opt-in e não é habilitado pelo motor de atenção.
 */
export const CADENCIAS_ATENCAO_PADRAO: Readonly<Record<EstadoAtencao, CadenciaPercepcao>> = {
  passivo: { deteccaoMs: 10_000, poseMs: 10_000, maosMs: 20_000 },
  atividade_detectada: { deteccaoMs: 5_000, poseMs: 5_000, maosMs: 10_000 },
  atencao: { deteccaoMs: 2_000, poseMs: 1_000, maosMs: 1_000 },
  interacao: { deteccaoMs: 1_000, poseMs: 500, maosMs: 250 },
  pos_evento: { deteccaoMs: 5_000, poseMs: 5_000, maosMs: 10_000 },
};

export interface EstadoAtencaoSeguranca {
  estado: EstadoAtencao;
  /** Sequência de amostras com atividade (não zera ao trocar de estado). */
  framesComSinal: number;
  /** Sequência de amostras sem atividade (não zera ao trocar de estado). */
  framesSemSinal: number;
  /** Amostras desde a última transição: evita interação imediata ao subir. */
  framesNoEstado: number;
  ultimaEvidenciaMs?: number;
  transicoes: number;
}

export function estadoInicialAtencao(): EstadoAtencaoSeguranca {
  return {
    estado: "passivo",
    framesComSinal: 0,
    framesSemSinal: 0,
    framesNoEstado: 0,
    transicoes: 0,
  };
}

/** Sinais já consolidados pelo chamador (presença, zonas e mudanças). */
export interface SinalAtencao {
  /** Instante epoch-ms da captura do frame. */
  tempoMs: number;
  pessoasAtivas?: number;
  entrouPessoa?: boolean;
  saiuPessoa?: boolean;
  zona?: TipoZonaAtencao | null;
  mudancaCena?: boolean;
  interacao?: boolean;
  /** `true` quando a inferência falhou: congela o estado. */
  percepcaoIndisponivel?: boolean;
}

export interface ResultadoAtencao {
  estado: EstadoAtencaoSeguranca;
  mudou: boolean;
  motivo: MotivoTransicaoAtencao;
}

function inteiroPositivo(valor: number | undefined, padrao: number): number {
  return typeof valor === "number" && Number.isFinite(valor) && valor >= 1
    ? Math.floor(valor)
    : padrao;
}

/**
 * Avança a máquina de estados. O resultado é sempre um objeto novo; a ordem das
 * verificações garante que interação vença estabilidade e que `pos_evento`
 * só volte a `passivo` depois de um segundo período de calma.
 */
export function reduzirAtencaoSeguranca(
  anterior: EstadoAtencaoSeguranca,
  sinal: SinalAtencao,
  config: ConfigAtencaoSeguranca = {}
): ResultadoAtencao {
  if (sinal.percepcaoIndisponivel) {
    return { estado: anterior, mudou: false, motivo: "percepcao_indisponivel" };
  }

  const paraAtividade = inteiroPositivo(config.framesParaAtividade, 1);
  const paraAtencao = inteiroPositivo(config.framesParaAtencao, 2);
  const paraInteracao = inteiroPositivo(config.framesParaInteracao, 2);
  const paraEstabilidade = inteiroPositivo(config.framesParaEstabilidade, 3);
  const manterMs = inteiroPositivo(config.manterAposUltimaEvidenciaMs, 5_000);

  const pessoas = sinal.pessoasAtivas ?? 0;
  const presenca = pessoas > 0 || sinal.entrouPessoa === true || sinal.zona === "entrada";
  const atividade =
    presenca ||
    sinal.saiuPessoa === true ||
    sinal.zona === "saida" ||
    sinal.mudancaCena === true;
  const interacao = sinal.interacao === true || (presenca && sinal.zona === "entrada");
  const tempoMs = Number.isFinite(sinal.tempoMs) ? sinal.tempoMs : undefined;

  const estadoBase: EstadoAtencaoSeguranca = {
    ...anterior,
    framesComSinal: atividade ? anterior.framesComSinal + 1 : 0,
    framesSemSinal: atividade ? 0 : anterior.framesSemSinal + 1,
    framesNoEstado: anterior.framesNoEstado + 1,
    ...(atividade && tempoMs !== undefined ? { ultimaEvidenciaMs: tempoMs } : {}),
  };
  const decorrido =
    tempoMs !== undefined && estadoBase.ultimaEvidenciaMs !== undefined
      ? tempoMs - estadoBase.ultimaEvidenciaMs
      : 0;
  const calmo =
    estadoBase.framesSemSinal >= paraEstabilidade && decorrido >= manterMs;

  let estado = estadoBase.estado;
  let motivo: MotivoTransicaoAtencao = "nenhum";

  switch (estadoBase.estado) {
    case "passivo":
      if (atividade && estadoBase.framesComSinal >= paraAtividade) {
        estado = atencaoOuAtividade(estadoBase, presenca || sinal.mudancaCena === true, paraAtencao);
        motivo = presenca || sinal.mudancaCena === true ? "presenca" : "atividade";
      }
      break;
    case "atividade_detectada":
      if (atividade && (presenca || sinal.mudancaCena === true) && estadoBase.framesComSinal >= paraAtencao) {
        estado = "atencao";
        motivo = "presenca";
      } else if (calmo) {
        estado = "pos_evento";
        motivo = "estabilidade";
      }
      break;
    case "atencao":
      if (interacao && estadoBase.framesNoEstado >= paraInteracao) {
        estado = "interacao";
        motivo = "interacao";
      } else if (calmo) {
        estado = "pos_evento";
        motivo = "estabilidade";
      }
      break;
    case "interacao":
      if (calmo) {
        estado = "pos_evento";
        motivo = "estabilidade";
      } else if (!interacao && atividade) {
        estado = "atencao";
        motivo = "presenca";
      }
      break;
    case "pos_evento":
      if (atividade) {
        estado = atencaoOuAtividade(estadoBase, presenca || sinal.mudancaCena === true, paraAtencao);
        motivo = presenca || sinal.mudancaCena === true ? "presenca" : "atividade";
      } else if (
        estadoBase.framesNoEstado >= paraEstabilidade * 2 &&
        decorrido >= manterMs * 2
      ) {
        estado = "passivo";
        motivo = "retorno_passivo";
      }
      break;
  }
  if (estado === "passivo" && interacao) {
    // Um sinal de interação não pode deixar a máquina em passivo, mesmo quando
    // a histerese de entrada ainda não foi satisfeita.
    estado = "atividade_detectada";
    motivo = "atividade";
  }

  const mudou = estado !== estadoBase.estado;
  return {
    estado: {
      ...estadoBase,
      estado,
      framesNoEstado: mudou ? 0 : estadoBase.framesNoEstado,
      transicoes: estadoBase.transicoes + (mudou ? 1 : 0),
    },
    mudou,
    motivo: mudou ? motivo : "nenhum",
  };
}

function atencaoOuAtividade(
  estado: EstadoAtencaoSeguranca,
  forte: boolean,
  limite: number
): EstadoAtencao {
  return forte && estado.framesComSinal >= limite ? "atencao" : "atividade_detectada";
}

/** Cadência efetiva do estado, mesclando sobrescritas com a tabela padrão. */
export function cadenciaParaEstadoAtencao(
  estado: EstadoAtencao,
  config: ConfigAtencaoSeguranca = {}
): CadenciaPercepcao {
  return { ...CADENCIAS_ATENCAO_PADRAO[estado], ...(config.cadencias?.[estado] ?? {}) };
}

/** Intervalo usado pelo laço de YOLO da câmera de segurança. */
export function intervaloDeteccaoAtencao(
  estado: EstadoAtencao,
  config: ConfigAtencaoSeguranca = {}
): number {
  return intervaloDaCadencia(cadenciaParaEstadoAtencao(estado, config), "deteccao") ?? 5_000;
}

/** Centro da caixa normalizada. */
export function pontoCentral(caixa: RegiaoCena): { x: number; y: number } {
  return { x: (caixa.xmin + caixa.xmax) / 2, y: (caixa.ymin + caixa.ymax) / 2 };
}

function dentro(ponto: { x: number; y: number }, caixa: RegiaoCena): boolean {
  return (
    ponto.x >= caixa.xmin &&
    ponto.x <= caixa.xmax &&
    ponto.y >= caixa.ymin &&
    ponto.y <= caixa.ymax
  );
}

/**
 * Zona que contém o centro da caixa. Entrada tem prioridade sobre saída quando
 * as áreas se sobrepõem — a decisão é conservadora para quem chega.
 */
export function zonaParaCaixa(
  zonas: readonly ZonaAtencao[],
  caixa: RegiaoCena
): TipoZonaAtencao | null {
  const ponto = pontoCentral(caixa);
  for (const zona of zonas) {
    if (zona.tipo === "entrada" && dentro(ponto, zona.caixa)) return "entrada";
  }
  for (const zona of zonas) {
    if (zona.tipo === "saida" && dentro(ponto, zona.caixa)) return "saida";
  }
  return null;
}

/** Constrói uma zona a partir de `"xmin,ymin,xmax,ymax"`, ou devolve erro. */
export function zonaDeTexto(
  zonaId: string,
  tipo: TipoZonaAtencao,
  texto: string
): ZonaAtencao | string {
  const partes = texto.split(",").map((parte) => Number(parte.trim()));
  if (partes.length !== 4 || partes.some((valor) => !Number.isFinite(valor))) {
    return `zona ${zonaId} deve ser xmin,ymin,xmax,ymax`;
  }
  const [xmin, ymin, xmax, ymax] = partes;
  if ([xmin, ymin, xmax, ymax].some((valor) => valor < 0 || valor > 1)) {
    return `zona ${zonaId} deve usar coordenadas entre 0 e 1`;
  }
  if (xmin > xmax || ymin > ymax) return `zona ${zonaId} tem extremos invertidos`;
  return { zonaId, tipo, caixa: { xmin, ymin, xmax, ymax } };
}
