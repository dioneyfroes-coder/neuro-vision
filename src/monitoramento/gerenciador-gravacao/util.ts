import type { SessaoMonitoramento, VideoSegment } from "../../domain";

const LIMITE_DATA_MS = 8.64e15;

export function instanteValido(ms: number): boolean {
  return Number.isFinite(ms) && Math.abs(ms) <= LIMITE_DATA_MS;
}

export function paraIso(ms: number): string {
  return new Date(ms).toISOString();
}

export function exigirPositivo(valor: number, nome: string): number {
  if (!Number.isFinite(valor) || valor <= 0) {
    throw new Error(`${nome} deve ser finito e maior que zero`);
  }
  return valor;
}

export function copiarSegmento(segmento: VideoSegment): VideoSegment {
  return {
    ...segmento,
    lacunas: segmento.lacunas.map((lacuna) => ({ ...lacuna })),
  };
}

export function copiarSessao(sessao: SessaoMonitoramento): SessaoMonitoramento {
  return { ...sessao };
}
