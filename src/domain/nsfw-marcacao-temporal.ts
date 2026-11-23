/**
 * Tempo real por marcação NSFW (Fase 4 do plano — análise multiframe).
 *
 * Hoje o tempo existe por **frame** no prompt multimodal, mas `MarcacaoNsfw`
 * não carrega instante algum. Este módulo é puro: enriquece marcações com o
 * carimbo do frame que as produziu e diz explicitamente quando o tempo não é
 * confiável. Nunca usa `Date.now()` — ausência de tempo vira incerteza, não
 * "agora". Nenhuma duração de ação é inferida da quantidade de imagens.
 */

import type { Caixa } from "./perception";

export interface TempoFrameNsfw {
  /** Id real do frame, quando disponível. */
  frameId?: string;
  /** Índice 1-based da imagem na ordem enviada ao modelo. */
  indice?: number;
  /** Instante ISO de captura. */
  capturadoEm?: string;
  /** Mesmo instante em ms, quando o produtor já o mediu. */
  capturadoEmMs?: number;
  /** Offset em relação ao início do clipe/ciclo. */
  offsetMs?: number;
}

/** Campos de tempo que podem ser aplicados a qualquer marcação. */
export interface CamposTemporaisNsfw {
  frameId?: string;
  indiceFrame?: number;
  capturadoEm?: string;
  capturadoEmMs?: number;
  offsetMs?: number;
  /** `false` quando não há captura confiável — o prompt deve dizer isso. */
  tempoConfiavel: boolean;
}

/** Uma marcação NSFW comum acrescida do carimbo do frame que a produziu. */
export interface MarcacaoNsfwTemporal extends CamposTemporaisNsfw {
  rotulo: string;
  score: number;
  caixa: Caixa;
  modelo?: string;
  modelos?: string[];
  limiarUsado?: number;
}

function msDeIso(valor: string | undefined): number | undefined {
  if (typeof valor !== "string") return undefined;
  const ms = Date.parse(valor);
  return Number.isFinite(ms) ? ms : undefined;
}

/** Aplica o carimbo de um frame a todas as suas marcações, sem inventar tempo. */
export function enriquecerMarcacoesTemporais<T extends { rotulo: string }>(
  marcacoes: ReadonlyArray<T>,
  tempo: TempoFrameNsfw = {}
): Array<T & CamposTemporaisNsfw> {
  const capturadoEmMs = Number.isFinite(tempo.capturadoEmMs)
    ? tempo.capturadoEmMs
    : msDeIso(tempo.capturadoEm);
  const offsetMs = Number.isFinite(tempo.offsetMs) ? tempo.offsetMs : undefined;
  const tempoConfiavel = capturadoEmMs !== undefined || offsetMs !== undefined;

  return marcacoes.map((m) => ({
    ...m,
    ...(typeof tempo.frameId === "string" && tempo.frameId.trim() !== ""
      ? { frameId: tempo.frameId }
      : {}),
    ...(Number.isInteger(tempo.indice) && (tempo.indice ?? 0) >= 1
      ? { indiceFrame: tempo.indice }
      : {}),
    ...(typeof tempo.capturadoEm === "string" && msDeIso(tempo.capturadoEm) !== undefined
      ? { capturadoEm: tempo.capturadoEm }
      : {}),
    ...(capturadoEmMs !== undefined ? { capturadoEmMs } : {}),
    ...(offsetMs !== undefined ? { offsetMs } : {}),
    tempoConfiavel,
  }));
}

/** Texto curto para o prompt; nunca transforma tempo ausente em zero. */
export function formatarTempoMarcacaoNsfw(
  m: Partial<CamposTemporaisNsfw>
): string {
  const referencia = m.frameId ? `frame ${m.frameId}` : m.indiceFrame ? `imagem ${m.indiceFrame}` : "";
  if (!m.tempoConfiavel) {
    return referencia ? `${referencia}; tempo_desconhecido` : "tempo_desconhecido";
  }
  const partes: string[] = [];
  if (m.capturadoEm) partes.push(`t=${m.capturadoEm}`);
  else if (m.capturadoEmMs !== undefined) partes.push(`t=${m.capturadoEmMs}ms`);
  if (m.offsetMs !== undefined) partes.push(`offset=${m.offsetMs}ms`);
  if (referencia) partes.push(referencia);
  return partes.join("; ");
}

/** Ordem cronológica validada; marcações sem tempo ficam no fim, sem serem descartadas. */
export function ordenarMarcacoesTemporais<T extends { tempoConfiavel: boolean; capturadoEmMs?: number; offsetMs?: number }>(
  marcacoes: ReadonlyArray<T>
): T[] {
  return [...marcacoes].sort((a, b) => {
    const ta = a.capturadoEmMs ?? a.offsetMs;
    const tb = b.capturadoEmMs ?? b.offsetMs;
    if (ta === undefined && tb === undefined) return 0;
    if (ta === undefined) return 1;
    if (tb === undefined) return -1;
    return ta - tb;
  });
}
