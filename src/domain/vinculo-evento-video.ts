/**
 * Vinculo entre registros com timestamp e segmentos de video (Fase 5).
 *
 * Regra pura e deterministica: nao le relogio, disco nem API de navegador. O
 * chamador fornece os instantes e os segmentos ja resolvidos pelo indice de
 * monitoramento. Um registro no limite exato de dois segmentos referencia
 * ambos. Um registro em lacuna/pausa nao recebe referencia que finja cobertura:
 * a janela e sempre recortada pela cobertura real dos segmentos.
 */
import type { LacunaGravacao, VideoSegment } from "./monitoramento";

/**
 * Contexto padrao ao redor de uma descricao ou fato visual pontual. Nao e
 * relogio: apenas converte o instante persistido em uma janela reproduzivel.
 */
export const JANELA_EVIDENCIA_ANTES_MS = 2_000;
export const JANELA_EVIDENCIA_DEPOIS_MS = 5_000;

/** Janela absoluta de um registro; `fimEm` ausente/invalido vira ponto em `inicioEm`. */
export interface JanelaEvento {
  inicioMs: number;
  fimMs: number;
}

/** Trecho reproduzivel dentro de um segmento que cobre o registro. */
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

/** Vincula uma janela numerica ja calculada; usado por eventos e por descricoes. */
export function vincularJanelaASegmentos(
  janela: JanelaEvento,
  segmentos: readonly VideoSegment[]
): ReferenciaVideoEvento[] {
  if (!Number.isFinite(janela.inicioMs) || !Number.isFinite(janela.fimMs)) return [];

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

/** Evento temporal com `inicioEm`/`fimEm` (janela explicita ou ponto). */
export function vincularEventoASegmentos(
  inicioEm: string,
  fimEm: string | undefined,
  segmentos: readonly VideoSegment[]
): ReferenciaVideoEvento[] {
  const janela = janelaEvento(inicioEm, fimEm);
  return janela ? vincularJanelaASegmentos(janela, segmentos) : [];
}

/**
 * Descricao ou fato visual pontual: so segmentos que **cobrem o instante**
 * entram; a janela de contexto e recortada dentro deles. Assim um ponto em
 * pausa/lacuna nao ganha video das extremidades da janela, e um ponto na
 * fronteira referencia os dois segmentos (com offsets opostos).
 */
export function vincularInstanteAosSegmentos(
  instanteMs: number,
  segmentos: readonly VideoSegment[],
  antesMs = JANELA_EVIDENCIA_ANTES_MS,
  depoisMs = JANELA_EVIDENCIA_DEPOIS_MS
): ReferenciaVideoEvento[] {
  if (!Number.isFinite(instanteMs)) return [];
  const cobrindo = segmentos.filter(
    (segmento) => segmento.inicioMs <= instanteMs && segmento.fimMs >= instanteMs
  );
  return vincularJanelaASegmentos(
    { inicioMs: instanteMs - antesMs, fimMs: instanteMs + depoisMs },
    cobrindo
  );
}
