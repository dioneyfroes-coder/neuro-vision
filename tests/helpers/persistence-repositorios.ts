import type { ObservacaoFrame } from "../../src/domain/observation";
import type { ResultadoCiclo } from "../../src/domain/cycle";
import type { EntradaLog, EventoVisual } from "../../src/types";
import { createServer } from "../../src/server";
import type { AddressInfo } from "node:net";

export function entrada(resumo: string): EntradaLog {
  return {
    timestamp: "2026-10-17T12:00:00.000Z",
    modelo: "m",
    objetos: [],
    resumo,
    tipo: "deteccao",
  };
}

export function evento(descricao: string): EventoVisual {
  return {
    id: `evt-${descricao}`,
    timestamp: "2026-10-17T12:00:00.000Z",
    tipo: "resumo",
    descricao,
    origem: "visao",
  };
}

export function observacao(
  frameId: string,
  poseIndisponivel = false
): ObservacaoFrame {
  return {
    sessionId: "sessao-1",
    cycleId: "sessao-1-c1",
    frameId,
    capturadoEm: "2026-10-17T12:00:00.000Z",
    capturadoEmMs: 1000,
    imagem: "data:image/jpeg;base64,QQ==",
    deteccoes: { deteccoes: [] },
    pose: poseIndisponivel
      ? { indisponivel: true, subsistema: "pose", motivo: "sem modelo" }
      : { pessoas: [] },
    maos: { maos: [] },
  };
}

export function resultadoCiclo(
  observacoes: ObservacaoFrame[],
  extras: Partial<ResultadoCiclo> = {}
): ResultadoCiclo {
  return {
    pacote: {
      sessionId: "sessao-1",
      cycleId: "sessao-1-c1",
      iniciadoEm: "2026-10-17T12:00:00.000Z",
      concluidoEm: "2026-10-17T12:00:01.000Z",
      observacoes,
      eventosTemporais: [],
      resumoTemporal: {
        eventos: [],
        tracksAtivos: 0,
        pessoasAtivas: 0,
        maosAtivas: 0,
        objetosAtivos: 0,
      },
      metricas: { capturaMs: 10, deteccaoMs: 20, totalMs: 30 },
    },
    erros: [],
    cancelado: false,
    ...extras,
  };
}

export async function comServidor<T>(
  config: Parameters<typeof createServer>[0],
  tarefa: (base: string) => Promise<T>
): Promise<T> {
  const server = createServer(config);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await tarefa(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
  }
}
