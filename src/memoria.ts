import fs from "node:fs";
import path from "node:path";
import type { EntradaLog, EventoVisual, TipoEventoVisual } from "./types";

/** Nivel de um registro operacional. */
export type NivelOperacional = "info" | "aviso" | "erro";

/**
 * Registro operacional: falhas e metricas que **nao** sao acontecimentos
 * visuais e por isso ficam separados dos eventos.
 */
export interface RegistroOperacional {
  timestamp: string;
  nivel: NivelOperacional;
  /** Subsistema que originou o registro (ex.: `cliente`, `ollama`, `armazenamento`). */
  origem: string;
  mensagem: string;
  detalhe?: string;
}

/** Rotaciona um JSONL para `.1` quando passa de `maxBytes`. */
export async function rotacionarJsonl(filePath: string, maxBytes: number): Promise<void> {
  try {
    const info = await fs.promises.stat(filePath);
    if (info.size < maxBytes) return;
  } catch {
    return;
  }
  await fs.promises.rename(filePath, `${filePath}.1`).catch(() => {});
}

/** Acrescenta um registro JSON como uma linha, criando diretorios e rotacionando. */
export async function appendJsonl<T>(
  registro: T,
  filePath: string,
  maxBytes: number
): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await rotacionarJsonl(filePath, maxBytes);
  await fs.promises.appendFile(filePath, JSON.stringify(registro) + "\n", "utf8");
}

async function lerUltimasLinhas(filePath: string, alvo: number): Promise<string[]> {
  const handle = await fs.promises.open(filePath, "r");
  try {
    let tamanho = (await handle.stat()).size;
    const chunkSize = 64 * 1024;
    let buffer = Buffer.alloc(0);
    let linhas: string[] = [];
    while (tamanho > 0 && linhas.length <= alvo) {
      const leitura = Math.min(chunkSize, tamanho);
      tamanho -= leitura;
      const chunk = Buffer.alloc(leitura);
      await handle.read(chunk, 0, leitura, tamanho);
      buffer = Buffer.concat([chunk, buffer]);
      linhas = buffer.toString("utf8").split("\n");
    }
    return linhas;
  } finally {
    await handle.close();
  }
}

/**
 * Le os ultimos registros (mais recente primeiro). Linhas invalidas sao
 * ignoradas silenciosamente; arquivo inexistente resulta em lista vazia.
 */
export async function lerUltimosJsonl<T>(
  filePath: string,
  limit: number,
  valida?: (valor: unknown) => valor is T
): Promise<T[]> {
  const n = Math.max(0, Math.trunc(limit));
  if (n === 0) return [];
  let linhas: string[];
  try {
    linhas = await lerUltimasLinhas(filePath, n);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const registros: T[] = [];
  for (const linha of linhas) {
    const texto = linha.trim();
    if (!texto) continue;
    try {
      const valor = JSON.parse(texto) as unknown;
      if (!valida || valida(valor)) registros.push(valor as T);
    } catch {
      // ignora linhas corrompidas
    }
  }
  return registros.slice(-n).reverse();
}

/** Esvazia o arquivo e remove a ultima rotacao. */
export async function limparJsonl(filePath: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, "", "utf8");
  await fs.promises.unlink(`${filePath}.1`).catch(() => {});
}

/** Tipos de evento visual aceitos (contrato de `EventoVisual`). */
export const TIPOS_EVENTO: TipoEventoVisual[] = [
  "aparicao",
  "desaparecimento",
  "movimento",
  "mudanca_de_cena",
  "resumo",
];

/** Normaliza um valor para `TipoEventoVisual` ou `null` quando desconhecido. */
export function normalizarTipoEvento(valor: unknown): TipoEventoVisual | null {
  return typeof valor === "string" && TIPOS_EVENTO.includes(valor as TipoEventoVisual)
    ? (valor as TipoEventoVisual)
    : null;
}

/** Valida e normaliza um evento vindo do cliente. */
export function montarEvento(payload: unknown): EventoVisual | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const p = payload as Record<string, unknown>;
  const origens: EventoVisual["origem"][] = ["detector", "rastreador", "ollama"];
  if (normalizarTipoEvento(p.tipo) === null) return null;
  if (typeof p.descricao !== "string") return null;
  if (typeof p.origem !== "string" || !origens.includes(p.origem as EventoVisual["origem"])) return null;
  return {
    id: typeof p.id === "string" && p.id ? p.id : `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: typeof p.timestamp === "string" ? p.timestamp : new Date().toISOString(),
    tipo: p.tipo as EventoVisual["tipo"],
    objetoId: typeof p.objetoId === "string" ? p.objetoId : undefined,
    descricao: p.descricao,
    confianca: typeof p.confianca === "number" && Number.isFinite(p.confianca) ? p.confianca : undefined,
    origem: p.origem as EventoVisual["origem"],
    snapshot: typeof p.snapshot === "string" ? p.snapshot : undefined,
    modelo: typeof p.modelo === "string" ? p.modelo : undefined,
    sessaoId: typeof p.sessaoId === "string" ? p.sessaoId : undefined,
    frameId: typeof p.frameId === "string" ? p.frameId : undefined,
  };
}

/** Valida e normaliza um registro operacional vindo do cliente. */
export function montarOperacional(payload: unknown): RegistroOperacional | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const p = payload as Record<string, unknown>;
  const niveis: NivelOperacional[] = ["info", "aviso", "erro"];
  if (typeof p.mensagem !== "string" || !p.mensagem) return null;
  return {
    timestamp: typeof p.timestamp === "string" ? p.timestamp : new Date().toISOString(),
    nivel: typeof p.nivel === "string" && niveis.includes(p.nivel as NivelOperacional)
      ? (p.nivel as NivelOperacional)
      : "info",
    origem: typeof p.origem === "string" && p.origem ? p.origem : "cliente",
    mensagem: p.mensagem,
    detalhe: typeof p.detalhe === "string" ? p.detalhe : undefined,
  };
}

/**
 * Filtros de consulta ao historico de eventos. Todos opcionais; quando ausente,
 * o criterio correspondente nao restringe o resultado (Fase 4 — consultas ao
 * historico respondendo "o que mudou", "quando" e as evidencias).
 */
export interface FiltrosEventos {
  /** Tipos aceitos; vazio/omisso = todos os tipos. */
  tipos?: TipoEventoVisual[];
  /** Somente eventos deste objeto rastreado (`objetoId`). */
  objetoId?: string;
  /** Inicio da janela (epoch ms, inclusive). */
  desdeMs?: number;
  /** Fim da janela (epoch ms, inclusive). */
  ateMs?: number;
}

/**
 * Filtra eventos por tipo, objeto e janela temporal. Eventos com `timestamp`
 * invalido sao mantidos (nao ha como compara-los com a janela).
 */
export function filtrarEventos(
  eventos: EventoVisual[],
  filtros: FiltrosEventos = {}
): EventoVisual[] {
  const tipos = filtros.tipos && filtros.tipos.length > 0 ? new Set(filtros.tipos) : null;
  return eventos.filter((evento) => {
    if (tipos && !tipos.has(evento.tipo)) return false;
    if (filtros.objetoId && evento.objetoId !== filtros.objetoId) return false;
    const instante = Date.parse(evento.timestamp);
    if (!Number.isFinite(instante)) return true;
    if (filtros.desdeMs !== undefined && instante < filtros.desdeMs) return false;
    if (filtros.ateMs !== undefined && instante > filtros.ateMs) return false;
    return true;
  });
}

/** Contexto curto reconstruido a partir do historico persistido (Fase 4.2). */
export interface ContextoMemoria {
  /** Ultimas entradas de historico (mais recente primeiro). */
  entradas: EntradaLog[];
  /** Ultimos eventos estruturados (mais recente primeiro). */
  eventos: EventoVisual[];
  /** Resumo curto do estado atual, pronto para o prompt. */
  resumo: string;
}

export interface OpcoesContexto {
  /** Maximo de entradas de historico consideradas. */
  maxEntradas?: number;
  /** Maximo de eventos considerados. */
  maxEventos?: number;
  /** Maximo de caracteres do resumo final. */
  maxCaracteres?: number;
}

const CONTEXTO_PADRAO = { maxEntradas: 20, maxEventos: 20, maxCaracteres: 1200 };

/**
 * Monta um resumo curto do estado recente a partir do historico persistido.
 * Estrategia: parte das descricoes/roteiros mais recentes e complementa com os
 * eventos mais recentes, tudo truncado por `maxCaracteres`.
 */
export function resumirContexto(
  entradas: EntradaLog[],
  eventos: EventoVisual[],
  opcoes: OpcoesContexto = {}
): ContextoMemoria {
  const { maxEntradas, maxEventos, maxCaracteres } = { ...CONTEXTO_PADRAO, ...opcoes };
  const entradasLimitadas = entradas.slice(0, Math.max(0, maxEntradas));
  const eventosLimitados = eventos.slice(0, Math.max(0, maxEventos));

  const partes: string[] = [];
  const descricoes = entradasLimitadas
    .filter((e) => e.tipo === "descricao" || e.tipo === "roteiro")
    .map((e) => e.resumo)
    .filter((r) => r.length > 0);
  if (descricoes.length > 0) partes.push(`Descricoes recentes: ${descricoes.slice(0, 5).join(" / ")}`);

  const rotulos = entradasLimitadas
    .filter((e) => e.tipo === "deteccao")
    .flatMap((e) => e.objetos.map((o) => o.nome));
  const unicos = [...new Set(rotulos)];
  if (unicos.length > 0) partes.push(`Objetos vistos: ${unicos.join(", ")}`);

  if (eventosLimitados.length > 0) {
    partes.push(`Eventos recentes: ${eventosLimitados.slice(0, 5).map((e) => e.descricao).join(" / ")}`);
  }

  const bruto = partes.join("\n");
  const resumo = bruto.length > maxCaracteres ? bruto.slice(0, maxCaracteres).trimEnd() : bruto;
  return { entradas: entradasLimitadas, eventos: eventosLimitados, resumo };
}

/** Estado de sessao reconstruido a partir da memoria persistida. */
export interface SessaoReidratada extends ContextoMemoria {
  /** Ultimos passos do roteiro (deltas), em ordem cronologica, para o prompt. */
  roteiro: string[];
  /** Ultima descricao/roteiro, usada como referencia da observacao anterior. */
  ultimaDescricao: string;
}

/**
 * Reidrata o contexto recente a partir do historico e dos eventos persistidos
 * (nao da memoria volatil da pagina). As compensacoes de janela sao aplicadas
 * por `resumirContexto`, evitando enviar todo o historico ao modelo.
 */
export function reidratarContexto(
  entradas: EntradaLog[],
  eventos: EventoVisual[],
  opcoes: OpcoesContexto = {}
): SessaoReidratada {
  const base = resumirContexto(entradas, eventos, opcoes);
  const cronologico = [...entradas].reverse();
  const roteiro = cronologico
    .filter((e) => e.tipo === "roteiro" && e.papel !== "base")
    .map((e) => e.resumo)
    .filter((r) => r.length > 0)
    .slice(-8);
  const ultimaDescricao =
    cronologico
      .filter((e) => e.tipo === "descricao" || e.tipo === "roteiro")
      .map((e) => e.resumo)
      .filter((r) => r.length > 0)
      .at(-1) ?? "";
  return { ...base, roteiro, ultimaDescricao };
}
