import { readFile } from "node:fs/promises";
import type { QuadroGravado, SessaoMonitoramento, VideoSegment } from "../../src/domain";

export const BASE = 1_700_000_000_000;
export const MAX_BYTES = 1_000_000;

export function quadro(frameId: string, offsetMs: number): QuadroGravado {
  return { frameId, capturadoEmMs: BASE + offsetMs };
}

export function sessao(overrides: Partial<SessaoMonitoramento> = {}): SessaoMonitoramento {
  return {
    sessaoId: "sessao-1",
    ambiente: "sala",
    iniciadaEm: new Date(BASE).toISOString(),
    iniciadaEmMs: BASE,
    estado: "ativa",
    duracaoSegmentoMs: 60_000,
    retencaoPreEventoMs: 10_000,
    limiarLacunaMs: 2000,
    ...overrides,
  };
}

export function segmento(
  segmentoId: string,
  sequencia: number,
  overrides: Partial<VideoSegment> = {}
): VideoSegment {
  const inicioMs = BASE + sequencia * 1000;
  return {
    segmentoId,
    sessaoId: "sessao-1",
    sequencia,
    inicioEm: new Date(inicioMs).toISOString(),
    inicioMs,
    fimEm: new Date(inicioMs + 1000).toISOString(),
    fimMs: inicioMs + 1000,
    duracaoMs: 1000,
    quadros: 1,
    estado: "fechado",
    motivoFim: "duracao",
    lacunas: [],
    ...overrides,
  };
}

export async function linhas(filePath: string): Promise<number> {
  try {
    const texto = await readFile(filePath, "utf8");
    return texto.split("\n").filter((linha) => linha.trim()).length;
  } catch {
    return 0;
  }
}
