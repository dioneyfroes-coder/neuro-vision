import type { EntradaLog } from "../../src/types";

export const entradaMemoria = (parcial: Partial<EntradaLog>): EntradaLog => ({
  timestamp: "2026-10-11T00:00:00.000Z",
  modelo: "m",
  objetos: [],
  resumo: "",
  tipo: "deteccao",
  ...parcial,
});
