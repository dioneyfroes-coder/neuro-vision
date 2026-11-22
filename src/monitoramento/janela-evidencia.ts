/**
 * Janela de evidência congelada no momento de um evento confirmado (Fase 3).
 *
 * O buffer circular guarda apenas quadros **capturados**. Ao confirmar uma
 * mudança, `criarJanelaEvidencia` copia o que já existia antes do gatilho e o
 * congela; quadros posteriores entram até o fim da janela pós-evento. Nenhum
 * quadro é sintetizado: buracos entre capturas viram `lacunas`, e a chamada de
 * segmentos de vídeo usa `segmentosParaIntervalo()` (via HTTP) para correlacionar
 * apenas gravação que de fato cobre o intervalo.
 */
import type {
  JanelaEvidenciaRegistro,
  QuadroEvidenciaRegistro,
} from "../domain/telemetria-atencao";

export type FaseQuadroEvidencia = "pre" | "durante" | "pos";

export interface QuadroEvidencia<T> {
  item: T;
  capturadoEmMs: number;
  fase: FaseQuadroEvidencia;
}

export interface LacunaEvidencia {
  inicioMs: number;
  fimMs: number;
}

export interface JanelaEvidencia<T> {
  eventoId: string;
  gatilhoEmMs: number;
  inicioMs: number;
  fimMs: number;
  congeladaEmMs?: number;
  quadros: QuadroEvidencia<T>[];
  lacunas: LacunaEvidencia[];
}

export interface ConfigJanelaEvidencia {
  /** Tempo antes do gatilho que a janela cobre (ms). */
  preMs: number;
  /** Tempo depois do gatilho que a janela aceita quadros (ms). */
  posMs: number;
  /**
   * Intervalo entre capturas acima do qual existe lacuna de cobertura (ms).
   * Padrão: 2000 ms, o mesmo limiar de falha de gravação.
   */
  limiteLacunaMs?: number;
}

function finito(ms: number): boolean {
  return Number.isFinite(ms);
}

function adicionarLacunas<T>(
  quadros: QuadroEvidencia<T>[],
  limiteLacunaMs: number
): LacunaEvidencia[] {
  const lacunas: LacunaEvidencia[] = [];
  for (let i = 1; i < quadros.length; i += 1) {
    const anterior = quadros[i - 1].capturadoEmMs;
    const atual = quadros[i].capturadoEmMs;
    if (atual - anterior > limiteLacunaMs) lacunas.push({ inicioMs: anterior, fimMs: atual });
  }
  return lacunas;
}

/** Congela a janela pré-evento a partir de quadros já capturados. */
export function criarJanelaEvidencia<T>(
  eventoId: string,
  gatilhoEmMs: number,
  quadrosPre: readonly { item: T; capturadoEmMs: number }[],
  config: ConfigJanelaEvidencia
): JanelaEvidencia<T> {
  if (!finito(gatilhoEmMs)) throw new Error("gatilhoEmMs deve ser finito");
  if (!finito(config.preMs) || config.preMs < 0 || !finito(config.posMs) || config.posMs < 0) {
    throw new Error("preMs e posMs devem ser finitos e nao negativos");
  }
  const limiteLacunaMs = config.limiteLacunaMs ?? 2_000;
  const inicioMs = gatilhoEmMs - config.preMs;
  const quadros = quadrosPre
    .filter((quadro) => finito(quadro.capturadoEmMs) && quadro.capturadoEmMs >= inicioMs && quadro.capturadoEmMs <= gatilhoEmMs)
    .map((quadro) => ({
      ...quadro,
      fase: (quadro.capturadoEmMs === gatilhoEmMs ? "durante" : "pre") as FaseQuadroEvidencia,
    }))
    .sort((a, b) => a.capturadoEmMs - b.capturadoEmMs);
  return {
    eventoId,
    gatilhoEmMs,
    inicioMs,
    fimMs: gatilhoEmMs + config.posMs,
    quadros,
    lacunas: adicionarLacunas(quadros, limiteLacunaMs),
  };
}

/**
 * Acrescenta um quadro real à janela aberta. Retorna a janela original quando o
 * quadro está fora do intervalo; nunca estende `fimMs` nem substitui o passado.
 */
export function acrescentarQuadroEvidencia<T>(
  janela: JanelaEvidencia<T>,
  item: T,
  capturadoEmMs: number,
  limiteLacunaMs = 2_000
): JanelaEvidencia<T> {
  if (janela.congeladaEmMs !== undefined) return janela;
  if (!finito(capturadoEmMs) || capturadoEmMs < janela.gatilhoEmMs || capturadoEmMs > janela.fimMs) {
    return janela;
  }
  const quadros = [
    ...janela.quadros,
    {
      item,
      capturadoEmMs,
      fase: (capturadoEmMs === janela.gatilhoEmMs ? "durante" : "pos") as FaseQuadroEvidencia,
    },
  ];
  return { ...janela, quadros, lacunas: adicionarLacunas(quadros, limiteLacunaMs) };
}

/** Fecha a janela: nenhum quadro entra depois disso. */
export function congelarJanelaEvidencia<T>(
  janela: JanelaEvidencia<T>,
  congeladaEmMs: number
): JanelaEvidencia<T> {
  if (!finito(congeladaEmMs)) return janela;
  return { ...janela, congeladaEmMs };
}

/** Resumo serializável da janela (sem os bytes/imagens dos quadros). */
export function janelaEvidenciaParaRegistro<T>(janela: JanelaEvidencia<T>): JanelaEvidenciaRegistro {
  const quadros: QuadroEvidenciaRegistro[] = janela.quadros.map((quadro) => ({
    capturadoEmMs: quadro.capturadoEmMs,
    fase: quadro.fase,
  }));
  return {
    eventoId: janela.eventoId,
    gatilhoEmMs: janela.gatilhoEmMs,
    inicioMs: janela.inicioMs,
    fimMs: janela.fimMs,
    congeladaEmMs: janela.congeladaEmMs,
    quadros,
    lacunas: janela.lacunas,
    segmentos: [],
  };
}
