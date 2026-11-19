import { QuadroRejeitadoError, type QuadroGravado, type VideoSegment } from "../../src/domain";

export const BASE = 1_700_000_000_000;

export function quadro(frameId: string, offsetMs: number): QuadroGravado {
  return { frameId, capturadoEmMs: BASE + offsetMs };
}

export function motivoRejeicao(acao: () => unknown): string | undefined {
  try {
    acao();
  } catch (erro) {
    return erro instanceof QuadroRejeitadoError ? erro.motivo : undefined;
  }
  return undefined;
}

export function sequencias(segmentos: VideoSegment[]): number[] {
  return segmentos.map((segmento) => segmento.sequencia);
}
