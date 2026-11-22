/**
 * Serialização determinística de eventos para exportação (Fase 5).
 *
 * Nenhuma função lê relógio, disco ou rede: `geradoEm` é fornecido pelo chamador
 * (servidor). Dois formatos são emitidos a partir da **mesma** linha do tempo —
 * JSONL (com cabeçalho de metadados) e CSV (metadados repetidos por linha, para
 * manter a tabela autocontida). Ausência continua ausente: campos não observados
 * viram célula vazia, nunca zero ou texto inventado.
 */
import type { CorrecaoEvento } from "./correcao-evento";
import type { EventoTemporal } from "./temporal-event";

export type FormatoExportacaoEventos = "jsonl" | "csv";

export interface MetadadosExportacaoEventos {
  geradoEm: string;
  versaoEsquema: number;
  sessaoId?: string;
  filtros?: Readonly<Record<string, string>>;
}

export interface RegistroExportacaoEventos {
  fluxo: "temporal" | "visual";
  eventoId: string;
  sessaoId?: string;
  tipo: string;
  estado?: string;
  statusEvidencia?: string;
  naturezaInteracao?: string;
  transicaoPosse?: string;
  pessoaEntidadeId?: string;
  entidadeId?: string;
  rotuloObjeto?: string;
  inicioEm: string;
  fimEm?: string;
  descricao: string;
  confianca?: number;
  segmentos?: number;
  versaoCorrecao?: number;
  corrigidoPor?: string;
  motivoCorrecao?: string;
}

/** Colunas canônicas do CSV, em ordem estável. */
export const COLUNAS_EXPORTACAO_EVENTOS = [
  "fluxo",
  "eventoId",
  "sessaoId",
  "tipo",
  "estado",
  "statusEvidencia",
  "naturezaInteracao",
  "transicaoPosse",
  "pessoaEntidadeId",
  "entidadeId",
  "rotuloObjeto",
  "inicioEm",
  "fimEm",
  "descricao",
  "confianca",
  "segmentos",
  "versaoEsquema",
  "geradoEm",
  "versaoCorrecao",
  "corrigidoPor",
  "motivoCorrecao",
] as const;

type ValorCelula = string | number | undefined;

function texto(valor: unknown): string | undefined {
  return typeof valor === "string" && valor.trim() ? valor : undefined;
}

export function registroDeEventoTemporal(
  evento: EventoTemporal & { segmentos?: readonly unknown[] },
  totalSegmentos?: number
): RegistroExportacaoEventos {
  const correcao: CorrecaoEvento | undefined = evento.correcao;
  return {
    fluxo: "temporal",
    eventoId: evento.eventoId,
    sessaoId: evento.sessionId,
    tipo: evento.tipo,
    estado: evento.estado,
    statusEvidencia: evento.statusEvidencia,
    naturezaInteracao: evento.naturezaInteracao,
    transicaoPosse: evento.transicaoPosse,
    pessoaEntidadeId: evento.pessoaEntidadeId,
    entidadeId: evento.entidadeId,
    rotuloObjeto: evento.rotuloObjeto,
    inicioEm: evento.inicioEm,
    fimEm: evento.fimEm,
    descricao: evento.descricao,
    confianca: evento.confianca,
    segmentos: totalSegmentos ?? evento.segmentos?.length,
    versaoCorrecao: correcao?.versao,
    corrigidoPor: correcao?.corrigidoPor,
    motivoCorrecao: correcao?.motivo,
  };
}

/** Evento visual legado adaptado ao mesmo vocabulário de exportação. */
export function registroDeEventoVisual(
  evento: {
    id: string;
    sessaoId?: string;
    tipo: string;
    timestamp: string;
    descricao: string;
    confianca?: number;
    rotuloObjeto?: string;
    objetoId?: string;
    segmentos?: readonly unknown[];
  },
  totalSegmentos?: number
): RegistroExportacaoEventos {
  return {
    fluxo: "visual",
    eventoId: evento.id,
    sessaoId: evento.sessaoId,
    tipo: evento.tipo,
    inicioEm: evento.timestamp,
    descricao: evento.descricao,
    confianca: evento.confianca,
    rotuloObjeto: evento.rotuloObjeto,
    entidadeId: texto(evento.objetoId),
    segmentos: totalSegmentos ?? evento.segmentos?.length,
  };
}

function celulaCsv(valor: ValorCelula): string {
  if (valor === undefined || valor === null) return "";
  const texto = String(valor);
  return /[",\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

function linhaCsv(registro: RegistroExportacaoEventos, metadados: MetadadosExportacaoEventos): string {
  const linha: Record<string, ValorCelula> = {
    ...registro,
    versaoEsquema: metadados.versaoEsquema,
    geradoEm: metadados.geradoEm,
    sessaoId: registro.sessaoId ?? metadados.sessaoId,
  };
  return COLUNAS_EXPORTACAO_EVENTOS.map((coluna) => celulaCsv(linha[coluna])).join(",");
}

export function serializarEventos(
  registros: readonly RegistroExportacaoEventos[],
  formato: FormatoExportacaoEventos,
  metadados: MetadadosExportacaoEventos
): string {
  if (formato === "csv") {
    const cabecalho = COLUNAS_EXPORTACAO_EVENTOS.join(",");
    const linhas = registros.map((registro) => linhaCsv(registro, metadados));
    return [cabecalho, ...linhas].join("\r\n") + "\r\n";
  }
  const cabecalho = {
    registro: "metadados",
    versao: metadados.versaoEsquema,
    geradoEm: metadados.geradoEm,
    sessaoId: metadados.sessaoId,
    total: registros.length,
    filtros: metadados.filtros ?? {},
  };
  const linhas = registros.map((registro) => ({ ...registro, registro: "evento" }));
  return [cabecalho, ...linhas].map((linha) => JSON.stringify(linha)).join("\n") + "\n";
}
