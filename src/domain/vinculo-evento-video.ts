/**
 * Vinculo entre eventos temporais e segmentos de video (Fase 5).
 *
 * Regra pura e deterministica: nao le relogio, disco nem API de navegador. O
 * chamador fornece os instantes ISO do evento e os segmentos ja resolvidos pelo
 * indice de monitoramento. Um evento no limite exato de dois segmentos referencia
 * os dois — o trecho no segmento que termina ali tem duracao zero e o trecho
 * util esta no segmento seguinte. Um evento em lacuna de gravacao nao recebe
 * referencia alguma: ausencia de video nao e video vazio.
 */
import type { LacunaGravacao, VideoSegment } from "./monitoramento";

/** Janela absoluta de um evento; `fimEm` ausente/invalido vira ponto em `inicioEm`. */
export interface JanelaEvento {
  inicioMs: number;
  fimMs: number;
}

/** Trecho reproduzivel dentro de um segmento que cobre o evento. */
export interface ReferenciaVideoEvento {
  segmentoId: string;
  sessaoId: string;
  sequencia: number;
  /** Cobertura do segmento em epoch ms (extremos inclusivos na consulta). */
  inicioMs: number;
  fimMs: number;
  /** Onde comecar e terminar a reproducao, em ms desde o inicio do segmento. */
  offsetMs: number;
  ateMs: number;
  duracaoTrechoMs: number;
  /** Segmento incompleto ou com lacuna e sinalizado, nunca escondido. */
  incompleto: boolean;
  lacunas: Array<Pick<LacunaGravacao, "inicioMs" | "fimMs">>;
}

function instanteValido(iso: string | undefined): number | undefined {
  if (typeof iso !== "string" || iso.length === 0) return undefined;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : undefined;
}

export function janelaEvento(inicioEm: string, fimEm?: string): JanelaEvento | undefined {
  const inicioMs = instanteValido(inicioEm);
  if (inicioMs === undefined) return undefined;
  const fim = instanteValido(fimEm);
  return { inicioMs, fimMs: fim !== undefined && fim >= inicioMs ? fim : inicioMs };
}

export function vincularEventoASegmentos(
  inicioEm: string,
  fimEm: string | undefined,
  segmentos: readonly VideoSegment[]
): ReferenciaVideoEvento[] {
  const janela = janelaEvento(inicioEm, fimEm);
  if (!janela) return [];

  return segmentos
    .filter(
      (segmento) =>
        segmento.inicioMs <= janela.fimMs && segmento.fimMs >= janela.inicioMs
    )
    .sort((a, b) => a.inicioMs - b.inicioMs || a.sequencia - b.sequencia)
    .map((segmento) => {
      const inicioTrecho = Math.max(janela.inicioMs, segmento.inicioMs);
      const fimTrecho = Math.min(janela.fimMs, segmento.fimMs);
      const offsetMs = inicioTrecho - segmento.inicioMs;
      return {
        segmentoId: segmento.segmentoId,
        sessaoId: segmento.sessaoId,
        sequencia: segmento.sequencia,
        inicioMs: segmento.inicioMs,
        fimMs: segmento.fimMs,
        offsetMs,
        ateMs: fimTrecho - segmento.inicioMs,
        duracaoTrechoMs: fimTrecho - inicioTrecho,
        incompleto: segmento.estado === "incompleto" || segmento.lacunas.length > 0,
        lacunas: segmento.lacunas.map(({ inicioMs, fimMs }) => ({ inicioMs, fimMs })),
      };
    });
}
