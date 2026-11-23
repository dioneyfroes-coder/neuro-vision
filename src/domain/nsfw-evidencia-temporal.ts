/**
 * Evidência temporal NSFW agregada por frame (Fase 4, plano §9).
 *
 * Resume sinais já medidos por marcação/classificação para a seleção adaptativa
 * de frames. É um **sinal fraco** de relevância: nunca substitui evento temporal
 * validado, nunca confirma ação e nunca estima duração a partir da contagem de
 * imagens. Sem tempo confiável, o frame entra com incerteza explícita.
 */

import type { MarcacaoNsfwClassificada } from "./nsfw-classificacao-rotulo";
import { ePropostaCena } from "./nsfw-classificacao-rotulo";
import type { MarcacaoNsfwTemporal } from "./nsfw-marcacao-temporal";

export interface EvidenciaNsfwPorFrame {
  frameId?: string;
  capturadoEmMs?: number;
  offsetMs?: number;
  totalMarcacoes: number;
  /** Rótulos de ação — sempre propostas, nunca confirmações. */
  acoes: string[];
  /** Rótulos anatômicos localizados. */
  anatomias: string[];
  /** Marcações apoiadas por mais de um modelo. */
  concordancias: number;
  /** Sinal fraco de relevância, limitado a 5 (evento validado vale muito mais). */
  sinal: number;
  motivos: string[];
  tempoConfiavel: boolean;
}

export interface ResumoEvidenciaTemporalNsfw {
  frames: EvidenciaNsfwPorFrame[];
  /** IDs de frames com proposta de ação em nível de cena. */
  framesComProposta: string[];
  temPropostaCena: boolean;
  /** `true` quando algum frame não tem carimbo de tempo utilizável. */
  tempoIncompleto: boolean;
}

function chaveFrame(m: MarcacaoNsfwTemporal): string {
  if (typeof m.frameId === "string" && m.frameId.trim() !== "") return m.frameId;
  if (m.capturadoEmMs !== undefined) return `t:${m.capturadoEmMs}`;
  if (m.offsetMs !== undefined) return `offset:${m.offsetMs}`;
  return "sem_id";
}

/**
 * Agrupa marcações enriquecidas + classificadas por frame.
 * A ordem de entrada não altera a saída (frames ordenados por tempo/ID).
 */
export function resumirEvidenciaTemporalNsfw(
  marcacoes: ReadonlyArray<MarcacaoNsfwTemporal & Partial<MarcacaoNsfwClassificada>>
): ResumoEvidenciaTemporalNsfw {
  const grupos = new Map<string, { tempo: MarcacaoNsfwTemporal; itens: typeof marcacoes[number][] }>();
  for (const m of marcacoes) {
    const id = chaveFrame(m);
    const existente = grupos.get(id);
    if (existente) existente.itens.push(m);
    else grupos.set(id, { tempo: m, itens: [m] });
  }

  const frames = [...grupos.entries()]
    .map(([id, { tempo, itens }]) => {
      const classificados = itens.map((m) =>
        "classificacao" in m && m.classificacao
          ? (m as MarcacaoNsfwTemporal & MarcacaoNsfwClassificada)
          : {
              rotulo: m.rotulo,
              marcacao: m,
              classificacao: {
                tipo: "regiao_corporal" as const,
                escopo: "local" as const,
                usoPermitido: "sinal_auxiliar" as const,
                origem: "vocabulario_catalogo" as const,
                confiavel: false,
              },
            }
      );
      const acoes = [...new Set(classificados.filter(ePropostaCena).map((c) => c.rotulo))].sort();
      const anatomias = [
        ...new Set(classificados.filter((c) => c.classificacao.tipo === "anatomia").map((c) => c.rotulo)),
      ].sort();
      const concordancias = itens.filter((m) => (m.modelos?.length ?? 0) > 1).length;
      const motivos: string[] = [];
      if (acoes.length > 0) motivos.push("nsfw_proposta_acao");
      if (concordancias > 0) motivos.push("nsfw_concordancia_modelos");
      if (!tempo.tempoConfiavel) motivos.push("nsfw_tempo_desconhecido");

      // Sinal deliberadamente fraco: ação=1, concordância=2 por marcação, teto 5.
      const sinal = Math.min(5, acoes.length + 2 * concordancias);
      return {
        ...(id.startsWith("t:") || id.startsWith("offset:") ? {} : { frameId: tempo.frameId }),
        ...(tempo.capturadoEmMs !== undefined ? { capturadoEmMs: tempo.capturadoEmMs } : {}),
        ...(tempo.offsetMs !== undefined ? { offsetMs: tempo.offsetMs } : {}),
        totalMarcacoes: itens.length,
        acoes,
        anatomias,
        concordancias,
        sinal,
        motivos,
        tempoConfiavel: tempo.tempoConfiavel,
      } satisfies EvidenciaNsfwPorFrame;
    })
    .sort(
      (a, b) =>
        (a.capturadoEmMs ?? a.offsetMs ?? Number.POSITIVE_INFINITY) -
          (b.capturadoEmMs ?? b.offsetMs ?? Number.POSITIVE_INFINITY) ||
        (a.frameId ?? "").localeCompare(b.frameId ?? "")
    );

  const framesComProposta = frames
    .filter((f) => f.acoes.length > 0 && f.frameId)
    .map((f) => f.frameId!)
    .sort();

  return {
    frames,
    framesComProposta,
    temPropostaCena: frames.some((f) => f.acoes.length > 0),
    tempoIncompleto: frames.some((f) => !f.tempoConfiavel),
  };
}

/** Sinal e motivos prontos para `FrameParaSelecao.sinaisNsfw`. */
export function sinalNsfwDoFrame(
  resumo: ResumoEvidenciaTemporalNsfw,
  frameId: string
): { sinal: number; motivos: string[] } {
  const encontrado = resumo.frames.find((f) => f.frameId === frameId);
  return encontrado
    ? { sinal: encontrado.sinal, motivos: encontrado.motivos }
    : { sinal: 0, motivos: [] };
}
