import type { PacoteCiclo } from "../../src/domain/cycle";
import type { ObservacaoFrame } from "../../src/domain";
import { indisponivel } from "../../src/domain/perception";

export const OBS_BASE: ObservacaoFrame = {
  sessionId: "s1",
  cycleId: "s1-c1",
  frameId: "f1",
  capturadoEm: "2026-10-17T12:00:00.000Z",
  capturadoEmMs: 0,
  imagem: "data:image/jpeg;base64,AAAA",
  deteccoes: { deteccoes: [{ nome: "pessoa", rotulo: "person", score: 0.9, caixa: { xmin: 0, ymin: 0, xmax: 100, ymax: 100 } }], modelo: "d" },
  pose: indisponivel("pose", "desativado"),
  maos: indisponivel("maos", "desativado"),
  metricas: {},
};

export const PACOTE: PacoteCiclo = {
  sessionId: "s1",
  cycleId: "s1-c1",
  iniciadoEm: "2026-10-17T12:00:00.000Z",
  concluidoEm: "2026-10-17T12:00:00.500Z",
  observacoes: [OBS_BASE],
  eventosTemporais: [],
  resumoTemporal: {
    eventos: [],
    tracksAtivos: 1,
    pessoasAtivas: 1,
    maosAtivas: 0,
    objetosAtivos: 0,
  },
  metricas: {},
};