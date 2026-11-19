/** Registro de ciclo usado pelos testes de agregacao. */
export const registro = (extra = {}) => ({
  sessionId: "variante-b",
  cycleId: "c1",
  frameIds: ["f1", "f2"],
  observacoes: 2,
  eventosTemporais: 1,
  subsistemasIndisponiveis: [],
  erros: [],
  metricas: { totalMs: 100, multimodalMs: 60 },
  cancelado: false,
  concluidoEm: "2026-10-20T12:00:00.000Z",
  ...extra,
});