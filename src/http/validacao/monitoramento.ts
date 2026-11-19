/** Validação/normalização de payloads do monitoramento (sessões, segmentos, quadros). */
import { MAX_QUADROS_POR_LOTE } from "../../monitoramento/servico-monitoramento";
import type { QuadroGravado } from "../../domain/monitoramento";
import { parsearInstante } from "./comum";

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
