/**
 * Consulta pura sobre eventos temporais (Fase 5).
 *
 * Usada pela rota HTTP, pela exportação e pelos testes. Nenhuma função lê
 * relógio, disco ou rede. A janela é de **sobreposição**: um evento longo que
 * começou antes de `desdeEm` e ainda estava ativo continua no resultado. Um
 * evento sem `fimEm` válido é tratado como ponto em `inicioEm`.
 */
import { eventoCorrespondeAacao, type EventoComAcao } from "./schema-evento";

export interface EventoFiltravel extends EventoComAcao {
  sessionId: string;
  estado: string;
  entidadeId?: string;
  rotuloObjeto?: string;
  participantes?: string[];
  /** Pessoa heurística associada à mão; distinta de `entidadeId` (pose). */
  pessoaEntidadeId?: string;
  inicioEm: string;
  fimEm?: string;
}

export interface FiltrosEventoTemporais {
  tipos?: readonly string[];
  estados?: readonly string[];
  entidadeId?: string;
  sessionId?: string;
  objetos?: readonly string[];
  participantes?: readonly string[];
  pessoaEntidadeId?: string;
  acoes?: readonly string[];
  desdeMs?: number;
  ateMs?: number;
}

/** Instante ISO em epoch ms; inválido/ausente vira `undefined`. */
export function instanteEvento(evento: EventoFiltravel, campo: "inicioEm" | "fimEm"): number | undefined {
  const valor = evento[campo];
  if (typeof valor !== "string" || !valor) return undefined;
  const ms = Date.parse(valor);
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * Casa quando há interseção entre a vida do evento e a janela pedida. Instante
 * inválido nunca é descartado por janela: ausência não vira exclusão silenciosa.
 */
export function eventoNaJanela(
  evento: EventoFiltravel,
  desdeMs?: number,
  ateMs?: number
): boolean {
  const inicio = instanteEvento(evento, "inicioEm");
  if (inicio === undefined) return true;
  const fim = instanteEvento(evento, "fimEm") ?? inicio;
  const inicioEfetivo = Math.min(inicio, fim);
  const fimEfetivo = Math.max(inicio, fim);
  if (desdeMs !== undefined && Number.isFinite(desdeMs) && fimEfetivo < desdeMs) return false;
  if (ateMs !== undefined && Number.isFinite(ateMs) && inicioEfetivo > ateMs) return false;
  return true;
}

export function filtrarEventosTemporais<T extends EventoFiltravel>(
  eventos: readonly T[],
  filtros: FiltrosEventoTemporais = {}
): T[] {
  return eventos.filter((evento) => {
    if (filtros.tipos?.length && !filtros.tipos.includes(evento.tipo)) return false;
    if (filtros.estados?.length && !filtros.estados.includes(evento.estado)) return false;
    if (filtros.entidadeId && evento.entidadeId !== filtros.entidadeId) return false;
    if (filtros.sessionId && evento.sessionId !== filtros.sessionId) return false;
    if (
      filtros.objetos?.length &&
      (!evento.rotuloObjeto || !filtros.objetos.includes(evento.rotuloObjeto))
    ) {
      return false;
    }
    if (
      filtros.participantes?.length &&
      !(evento.participantes ?? []).some((id) => filtros.participantes?.includes(id))
    ) {
      return false;
    }
    if (filtros.pessoaEntidadeId && evento.pessoaEntidadeId !== filtros.pessoaEntidadeId) {
      return false;
    }
    if (!eventoCorrespondeAacao(evento, filtros.acoes ?? [])) return false;
    return eventoNaJanela(evento, filtros.desdeMs, filtros.ateMs);
  });
}
