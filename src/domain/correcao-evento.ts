/**
 * Correção humana auditável de eventos (Fase 5).
 *
 * A correção é **aditiva**: o stream permanece append-only e cada versão guarda
 * quem corrigiu, quando, por quê e o valor original do campo alterado. Nunca se
 * altera identidade, tempo, evidência, `statusEvidencia` ou ciclo de vida do
 * evento — esses campos continuam sendo derivados/autoritativos do servidor.
 */
import type { EventoTemporal } from "./temporal-event";

/**Únicos campos que uma pessoa pode corrigir em um evento temporal. */
export const CAMPOS_CORRIGIVEIS = [
  "descricao",
  "rotuloObjeto",
  "pessoaEntidadeId",
  "entidadeId",
  "naturezaInteracao",
  "transicaoPosse",
  "estadoAnterior",
  "estadoPosterior",
] as const;

export type CampoCorrigivel = (typeof CAMPOS_CORRIGIVEIS)[number];

const NATUREZAS: readonly string[] = ["proximidade", "contato", "manipulacao"];
const TRANSICOES: readonly string[] = ["pego", "deixado"];

export type AlteracoesCorrecao = Partial<Record<CampoCorrigivel, string | null>>;

export interface PedidoCorrecaoEvento {
  eventoId: string;
  corrigidoPor: string;
  motivo: string;
  /** `null` remove o campo, devolvendo-o à ausência (nunca a um valor inventado). */
  alteracoes: AlteracoesCorrecao;
}

export interface CorrecaoEvento {
  corrigidoEm: string;
  corrigidoPor: string;
  motivo: string;
  /**Versão da correção dentro do mesmo `eventoId` (começa em 1). */
  versao: number;
  /** Valores imediatamente anteriores, para auditar o que foi mudado. */
  valorOriginal: Partial<Record<CampoCorrigivel, string>>;
}

function textoObrigatorio(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() ? valor.trim() : null;
}

export function validarPedidoCorrecao(payload: unknown): PedidoCorrecaoEvento | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const p = payload as Record<string, unknown>;
  const eventoId = textoObrigatorio(p.eventoId);
  const corrigidoPor = textoObrigatorio(p.corrigidoPor);
  const motivo = textoObrigatorio(p.motivo);
  if (!eventoId || !corrigidoPor || !motivo) return null;
  if (typeof p.alteracoes !== "object" || p.alteracoes === null || Array.isArray(p.alteracoes)) {
    return null;
  }
  const alteracoes: AlteracoesCorrecao = {};
  let quantidade = 0;
  for (const campo of CAMPOS_CORRIGIVEIS) {
    const valor = (p.alteracoes as Record<string, unknown>)[campo];
    if (valor === undefined) continue;
    if (valor !== null && typeof valor !== "string") return null;
    if (valor === null) {
      alteracoes[campo] = null;
      quantidade += 1;
      continue;
    }
    const texto = valor.trim();
    if (!texto) return null;
    if (campo === "naturezaInteracao" && !NATUREZAS.includes(texto)) return null;
    if (campo === "transicaoPosse" && !TRANSICOES.includes(texto)) return null;
    alteracoes[campo] = texto;
    quantidade += 1;
  }
  if (quantidade === 0) return null;
  return { eventoId, corrigidoPor, motivo, alteracoes };
}

/**
 * Devolve uma **nova** versão do evento. O objeto de entrada não é mutado, e a
 * versaõ anterior continua no stream append-only para consulta/auditoria.
 */
export function aplicarCorrecaoEvento<T extends EventoTemporal>(
  evento: T,
  pedido: PedidoCorrecaoEvento,
  corrigidoEm: string
): T {
  const valorOriginal: Partial<Record<CampoCorrigivel, string>> = {};
  const alterados: Record<string, unknown> = {};
  for (const campo of CAMPOS_CORRIGIVEIS) {
    if (!Object.prototype.hasOwnProperty.call(pedido.alteracoes, campo)) continue;
    const anterior = evento[campo];
    if (typeof anterior === "string" && anterior.trim()) valorOriginal[campo] = anterior;
    alterados[campo] = pedido.alteracoes[campo] ?? undefined;
  }
  const correcao: CorrecaoEvento = {
    corrigidoEm,
    corrigidoPor: pedido.corrigidoPor,
    motivo: pedido.motivo,
    versao: (evento.correcao?.versao ?? 0) + 1,
    valorOriginal,
  };
  return { ...evento, ...alterados, correcao } as T;
}
