/**
 * Schema canônico do evento estruturado (Fase 5).
 *
 * `EventoTemporal` é o contrato canônico de eventos com identidade, evidência e
 * incerteza. Os streams antigos (`visao.jsonl`, `eventos.jsonl`) permanecem como
 * legado adaptado na leitura — este módulo não cria um segundo formato nem
 * migra dados silenciosamente. A versão é explícita para permitir evolução
 * aditiva futura sem quebrar registros já persistidos.
 */
import type { NaturezaInteracao, TransicaoPosse } from "./acoes-observaveis";

export const VERSAO_ESQUEMA_EVENTO = 1;

/** Valores aceitos no filtro `acao` das consultas e da exportação. */
export const ACOES_EVENTO = [
  "proximidade",
  "contato",
  "manipulacao",
  "pego",
  "deixado",
  "interacao_objeto",
  "movimento_objeto",
  "gesto_detectado",
  "braco_levantado",
  "transicao_acao",
  "movimento_corporal",
  "pose_compativel_sexual",
] as const;

export type AcaoEvento = (typeof ACOES_EVENTO)[number];

const NATUREZAS: readonly NaturezaInteracao[] = ["proximidade", "contato", "manipulacao"];
const TRANSICOES: readonly TransicaoPosse[] = ["pego", "deixado"];

export interface EventoComAcao {
  tipo: string;
  naturezaInteracao?: NaturezaInteracao;
  transicaoPosse?: TransicaoPosse;
}

/**
 * `acao` casa com o campo semântico quando ele existe (natureza/posse) e, na
 * ausência dele, com o tipo do evento. Um filtro por `contato` não casa com um
 * `interacao_objeto` que só tinha proximidade — ausência não é preenchida.
 */
export function eventoCorrespondeAacao(evento: EventoComAcao, acoes: readonly string[]): boolean {
  if (acoes.length === 0) return true;
  return acoes.some((acao) => {
    if (NATUREZAS.includes(acao as NaturezaInteracao)) {
      return evento.naturezaInteracao === acao;
    }
    if (TRANSICOES.includes(acao as TransicaoPosse)) {
      return evento.transicaoPosse === acao;
    }
    return evento.tipo === acao;
  });
}

/** Descritor único do contrato canônico, reutilizado por API, UI e exportação. */
export const DESCRITOR_ESQUEMA_EVENTO = {
  versao: VERSAO_ESQUEMA_EVENTO,
  contratoCanonico: "EventoTemporal",
  streamCanonico: "eventos-temporais.jsonl",
  streamsLegados: ["visao.jsonl", "eventos.jsonl"],
  acoes: ACOES_EVENTO,
} as const;
