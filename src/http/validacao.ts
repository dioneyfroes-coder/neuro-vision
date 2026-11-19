/**
 * Normalizadores e validadores puros de payloads e parametros.
 *
 * Extraido de `src/server.ts` na refatoracao de responsabilidades.
 */
import { normalizarTipoEvento } from "../memoria";
import { MAX_QUADROS_POR_LOTE } from "../monitoramento/servico-monitoramento";
import { ItemCena } from "../domain/cena";
import { OpcoesComparacaoCena } from "../domain/cena";
import { itemCenaValido } from "../domain/cena";
import { QuadroGravado } from "../domain/monitoramento";
import { Caixa } from "../types";
import { EntradaLog } from "../types";
import { MarcacaoNsfwLog } from "../types";
import { MotivoAnalise } from "../types";
import { ObjetoVisto } from "../types";
import { TipoEntrada } from "../types";
import { TipoEventoVisual } from "../types";
import { normalizarCaixaNsfw } from "../nsfw-prompt";

import { campoTipoTexto } from "./persistencia";

export function normalizarCaixa(valor: unknown): Caixa {
  const v = (typeof valor === "object" && valor !== null ? valor : {}) as Record<string, unknown>;
  const num = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  return {
    xmin: num(v.xmin),
    ymin: num(v.ymin),
    xmax: num(v.xmax),
    ymax: num(v.ymax),
  };
}

export function normalizarObjetos(valor: unknown): ObjetoVisto[] {
  if (!Array.isArray(valor)) return [];
  const objetos: ObjetoVisto[] = [];
  for (const item of valor) {
    if (typeof item !== "object" || item === null || !("nome" in item)) continue;
    const o = item as Record<string, unknown>;
    if (typeof o.nome !== "string") continue;
    objetos.push({
      nome: o.nome,
      rotulo: typeof o.rotulo === "string" ? o.rotulo : o.nome,
      score: typeof o.score === "number" && Number.isFinite(o.score) ? o.score : 0,
      caixa: normalizarCaixa(o.caixa),
    });
  }
  return objetos;
}

/**
 * Normaliza marcacoes NSFW recebidas do cliente.
 *
 * O cliente ja envia caixas normalizadas; aqui apenas validamos tipos e
 * limitamos score/caixa a [0, 1]. Uma lista vazia e preservada (o subsistema
 * rodou e nao encontrou nada), enquanto `undefined` significa desligado.
 */
export function normalizarMarcacoesNsfw(valor: unknown): MarcacaoNsfwLog[] | undefined {
  if (valor === undefined || valor === null) return undefined;
  if (!Array.isArray(valor)) return undefined;
  const marcacoes: MarcacaoNsfwLog[] = [];
  for (const item of valor) {
    if (typeof item !== "object" || item === null) continue;
    const m = item as Record<string, unknown>;
    if (typeof m.rotulo !== "string" || m.rotulo.length === 0) continue;
    const score = campoNumero(m.score);
    const modelo = typeof m.modelo === "string" && m.modelo.length > 0 ? m.modelo : undefined;
    const modelos = Array.isArray(m.modelos)
      ? m.modelos.filter((valor): valor is string => typeof valor === "string" && valor.length > 0)
      : undefined;
    marcacoes.push({
      rotulo: m.rotulo,
      score: score === undefined ? 0 : Math.min(1, Math.max(0, score)),
      caixa: normalizarCaixaNsfw(normalizarCaixa(m.caixa)),
      ...(modelo ? { modelo } : {}),
      ...(modelos?.length ? { modelos } : {}),
    });
  }
  return marcacoes;
}

export const MOTIVOS_VALIDOS: MotivoAnalise[] = [
  "primeira_analise",
  "mudanca_de_cena",
  "nova_entidade",
  "desaparecimento",
  "movimento",
  "baixa_confianca",
  "resumo_periodico",
  "manual",
  "falha_percepcao",
];

/** Normaliza um valor de `motivo` para o tipo ou `undefined` quando invalido. */
export function normalizarMotivo(valor: unknown): MotivoAnalise | undefined {
  return typeof valor === "string" && MOTIVOS_VALIDOS.includes(valor as MotivoAnalise)
    ? (valor as MotivoAnalise)
    : undefined;
}

export const TIPOS_ENTRADA: TipoEntrada[] = ["deteccao", "descricao", "roteiro"];

/** Normaliza o tipo de entrada aceito em `POST /api/log` (inclui `roteiro`). */
export function normalizarTipoEntrada(valor: unknown): TipoEntrada {
  return typeof valor === "string" && TIPOS_ENTRADA.includes(valor as TipoEntrada)
    ? (valor as TipoEntrada)
    : "deteccao";
}

/** Preserva apenas numeros finitos; descarta strings, NaN e Infinity. */
export function campoNumero(valor: unknown): number | undefined {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : undefined;
}

/** O papel (`base`/`delta`) so faz sentido em entradas do tipo `roteiro`. */
export function normalizarPapel(valor: unknown, tipo: TipoEntrada): "base" | "delta" | undefined {
  if (tipo !== "roteiro") return undefined;
  return valor === "base" || valor === "delta" ? valor : undefined;
}

export function montarEntrada(payload: unknown): EntradaLog {
  const p = (typeof payload === "object" && payload !== null ? payload : {}) as Record<
    string,
    unknown
  >;
  const tipo = normalizarTipoEntrada(p.tipo);
  return {
    timestamp: typeof p.timestamp === "string" ? p.timestamp : new Date().toISOString(),
    modelo: typeof p.modelo === "string" ? p.modelo : "desconhecido",
    objetos: normalizarObjetos(p.objetos),
    resumo: typeof p.resumo === "string" ? p.resumo : "",
    tipo,
    papel: normalizarPapel(p.papel, tipo),
    capturadoEm: typeof p.capturadoEm === "string" ? p.capturadoEm : undefined,
    ms: campoNumero(p.ms),
    tokens: campoNumero(p.tokens),
    motivo: normalizarMotivo(p.motivo),
    sessaoId: typeof p.sessaoId === "string" ? p.sessaoId : undefined,
    frameId: typeof p.frameId === "string" ? p.frameId : undefined,
    frameIds: Array.isArray(p.frameIds)
      ? p.frameIds.filter((id): id is string => typeof id === "string")
      : undefined,
    nsfw: normalizarMarcacoesNsfw(p.nsfw),
  };
}

/** Valida o payload de um evento estruturado vindo do cliente. */
export function validarPayloadEvento(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return "payload deve ser um objeto";
  }
  const p = payload as Record<string, unknown>;
  const erroTipo = campoTipoTexto(p.descricao, "descricao");
  if (erroTipo) return erroTipo;
  if (typeof p.descricao !== "string" || !p.descricao) return "campo 'descricao' obrigatorio";
  if (typeof p.tipo !== "string") return "campo 'tipo' obrigatorio";
  if (typeof p.origem !== "string") return "campo 'origem' obrigatorio";
  return null;
}

export function inteiroLimitado(valor: string | null, padrao: number, min: number, max: number): number {
  if (valor === null || valor.trim() === "") return padrao;
  const n = Number(valor);
  if (!Number.isFinite(n)) return padrao;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

/**
 * Le um instante de um parametro de query: aceita epoch ms (`"1728000000000"`)
 * ou data ISO (`"2026-10-11T00:00:00Z"`). Retorna `undefined` quando ausente ou
 * invalido, para o filtro correspondente nao restringir o resultado.
 */
export function parsearInstante(valor: string | null): number | undefined {
  if (valor === null) return undefined;
  const texto = valor.trim();
  if (!texto) return undefined;
  const numero = Number(texto);
  if (Number.isFinite(numero)) return numero;
  const data = Date.parse(texto);
  return Number.isFinite(data) ? data : undefined;
}

/** Le a lista de tipos de evento de `?tipo=aparicao,movimento`, descartando invalidos. */
export function parsearTiposEvento(valor: string | null): TipoEventoVisual[] {
  if (!valor) return [];
  const tipos = valor
    .split(",")
    .map((t) => normalizarTipoEvento(t.trim()))
    .filter((t): t is TipoEventoVisual => t !== null);
  return [...new Set(tipos)];
}

/* ------------------------------------------------------------------------- *
 * Monitoramento (Fase 3) - sessoes, segmentos e indice duravel
 * ------------------------------------------------------------------------- */

/**
 * Corpo de `POST /api/monitoramento/sessoes`. `ambiente` e obrigatorio; os
 * parametros de segmentacao sao opcionais e validados antes de abrir a sessao.
 */
export interface OpcoesInicioMonitoramento {
  ambiente: string;
  agoraMs: number;
  duracaoSegmentoMs?: number;
  retencaoPreEventoMs?: number;
  limiarLacunaMs?: number;
}

/**
 * Le um instante do corpo (epoch ms ou ISO). `undefined` quando o campo nao
 * veio; `NaN` quando veio presente e invalido - o chamador decide se o padrao
 * vale ou se o payload deve ser recusado.
 */
export function lerInstanteDoCorpo(valor: unknown): number | undefined {
  if (valor === undefined || valor === null) return undefined;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : Number.NaN;
  if (typeof valor === "string") {
    const texto = valor.trim();
    if (!texto) return Number.NaN;
    return parsearInstante(texto) ?? Number.NaN;
  }
  return Number.NaN;
}

export function numeroPositivoOuErro(valor: unknown, nome: string): number | string | undefined {
  if (valor === undefined || valor === null) return undefined;
  const n = typeof valor === "number" ? valor : Number(valor);
  if (!Number.isFinite(n) || n <= 0) return `${nome} deve ser finito e maior que zero`;
  return n;
}

/** Valida e normaliza o corpo de `POST /api/monitoramento/sessoes`. */
export function montarInicioMonitoramento(
  payload: unknown,
  agoraPadrao: number
): OpcoesInicioMonitoramento | string {
  const p = (typeof payload === "object" && payload !== null ? payload : {}) as Record<
    string,
    unknown
  >;
  const ambiente = typeof p.ambiente === "string" ? p.ambiente.trim() : "";
  if (!ambiente) return "campo 'ambiente' obrigatorio";

  const lido = lerInstanteDoCorpo(p.agoraMs);
  if (lido !== undefined && !Number.isFinite(lido)) {
    return "campo 'agoraMs' deve ser um instante finito em epoch ms ou ISO";
  }

  const duracaoSegmentoMs = numeroPositivoOuErro(p.duracaoSegmentoMs, "duracaoSegmentoMs");
  if (typeof duracaoSegmentoMs === "string") return duracaoSegmentoMs;
  const retencaoPreEventoMs = numeroPositivoOuErro(p.retencaoPreEventoMs, "retencaoPreEventoMs");
  if (typeof retencaoPreEventoMs === "string") return retencaoPreEventoMs;
  const limiarLacunaMs = numeroPositivoOuErro(p.limiarLacunaMs, "limiarLacunaMs");
  if (typeof limiarLacunaMs === "string") return limiarLacunaMs;

  return {
    ambiente,
    agoraMs: lido ?? agoraPadrao,
    ...(duracaoSegmentoMs !== undefined ? { duracaoSegmentoMs } : {}),
    ...(retencaoPreEventoMs !== undefined ? { retencaoPreEventoMs } : {}),
    ...(limiarLacunaMs !== undefined ? { limiarLacunaMs } : {}),
  };
}

/** Instante do corpo para encerrar/interromper; cai no padrao quando ausente. */
export function montarAgoraMonitoramento(payload: unknown, agoraPadrao: number): number | string {
  const p = (typeof payload === "object" && payload !== null ? payload : {}) as Record<
    string,
    unknown
  >;
  const lido = lerInstanteDoCorpo(p.agoraMs);
  if (lido !== undefined && !Number.isFinite(lido)) {
    return "campo 'agoraMs' deve ser um instante finito em epoch ms ou ISO";
  }
  return lido ?? agoraPadrao;
}

/**
 * Valida e normaliza o corpo de `POST /api/monitoramento/quadros`.
 *
 * O lote chega em ordem de chegada; o servico atribui cada quadro ao segmento
 * pelo instante de **captura**. Um lote vazio ou acima de
 * `MAX_QUADROS_POR_LOTE` e recusado inteiro, antes de qualquer atribuicao.
 */
export function montarQuadrosMonitoramento(payload: unknown): QuadroGravado[] | string {
  const p = (typeof payload === "object" && payload !== null ? payload : {}) as Record<
    string,
    unknown
  >;
  if (!Array.isArray(p.quadros) || p.quadros.length === 0) {
    return "campo 'quadros' obrigatorio (lista nao vazia)";
  }
  if (p.quadros.length > MAX_QUADROS_POR_LOTE) {
    return `no maximo ${MAX_QUADROS_POR_LOTE} quadros por lote`;
  }
  const quadros: QuadroGravado[] = [];
  for (const item of p.quadros) {
    const q = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    if (typeof q.frameId !== "string" || !q.frameId.trim()) {
      return "cada quadro exige 'frameId' (string nao vazia)";
    }
    const capturadoEmMs = lerInstanteDoCorpo(q.capturadoEmMs);
    if (capturadoEmMs === undefined || !Number.isFinite(capturadoEmMs)) {
      return `quadro ${q.frameId} exige 'capturadoEmMs' finito em epoch ms`;
    }
    quadros.push({ frameId: q.frameId, capturadoEmMs });
  }
  return quadros;
}

/* ------------------------------------------------------------------------- *
 * Referencia do ambiente e mudancas (Fase 3)
 * ------------------------------------------------------------------------- */

/** Corpo de `POST .../cena/referencia` e `POST .../cena/comparar`. */
export function montarItensCena(payload: unknown): ItemCena[] | string {
  const p = (typeof payload === "object" && payload !== null ? payload : {}) as Record<
    string,
    unknown
  >;
  if (!Array.isArray(p.itens)) return "campo 'itens' obrigatorio (lista)";
  for (const item of p.itens) {
    if (!itemCenaValido(item)) {
      return `item de cena invalido: ${JSON.stringify(item)}`;
    }
  }
  return p.itens as ItemCena[];
}

/** Opcoes numericas da comparacao, cada uma dentro do intervalo permitido. */
export function montarComparacaoCena(payload: unknown): OpcoesComparacaoCena | string {
  const p = (typeof payload === "object" && payload !== null ? payload : {}) as Record<
    string,
    unknown
  >;
  const opcoes: OpcoesComparacaoCena = {};
  for (const [chave, maximo] of [
    ["iouMinimo", 1],
    ["distanciaMaxima", 2],
  ] as const) {
    const valor = p[chave];
    if (valor === undefined || valor === null) continue;
    const n = typeof valor === "number" ? valor : Number(valor);
    if (!Number.isFinite(n) || n < 0 || n > maximo) {
      return `campo '${chave}' deve estar em [0, ${maximo}]`;
    }
    opcoes[chave] = n;
  }
  return opcoes;
}
