import type { Caixa, Deteccao } from "./perception";
import type { EventoTemporal, TipoEventoTemporal } from "./temporal-event";

/**
 * Adaptadores temporarios entre os contratos de dominio e os tipos legados
 * (`EntradaLog`, `ResultadoPercepcao`, `ObjetoVisto`, `EventoVisual`), ate que a
 * migracao seja completa (Etapa 1 do roteiro). Nenhum deles importa SDKs de
 * modelo.
 */

/** Tipo legado de objeto detectado (espelha `ObjetoVisto` de `src/types.ts`). */
export interface ObjetoVistoLegado {
  nome: string;
  rotulo: string;
  score: number;
  caixa: Caixa;
}

export function deteccaoParaLegado(d: Deteccao): ObjetoVistoLegado {
  return { nome: d.nome, rotulo: d.rotulo, score: d.score, caixa: d.caixa };
}

export function deteccaoDeLegado(o: ObjetoVistoLegado): Deteccao {
  return { nome: o.nome, rotulo: o.rotulo, score: o.score, caixa: o.caixa };
}

/** Evento legado (espelha `EventoVisual` de `src/types.ts`). */
export interface EventoVisualLegado {
  id: string;
  timestamp: string;
  tipo: string;
  objetoId?: string;
  descricao: string;
  confianca?: number;
  origem: "detector" | "rastreador" | "visao";
  snapshot?: string;
  modelo?: string;
  sessaoId?: string;
  idempotencyKey?: string;
  frameId?: string;
}

const TIPOS_VISUAIS_POR_TEMPORAL: Record<TipoEventoTemporal, EventoVisualLegado["tipo"]> = {
  gesto_detectado: "movimento",
  braco_levantado: "movimento",
  movimento_corporal: "movimento",
  aparicao: "aparicao",
  desaparecimento: "desaparecimento",
  mudanca_de_cena: "mudanca_de_cena",
};

/** Converte um evento temporal no formato legado para a persistencia atual. */
export function eventoTemporalParaLegado(evt: EventoTemporal): EventoVisualLegado {
  return {
    id: evt.eventoId,
    timestamp: evt.inicioEm,
    tipo: TIPOS_VISUAIS_POR_TEMPORAL[evt.tipo],
    objetoId: evt.entidadeId,
    descricao: evt.descricao,
    confianca: evt.confianca,
    origem: "rastreador",
    sessaoId: evt.sessionId,
    frameId: evt.frameIds[0],
  };
}
