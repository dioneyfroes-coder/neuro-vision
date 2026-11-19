import { describe, expect, it } from "vitest";

import {
  filtrarCiclosDaVariante,
  identificarVarianteDoRegistro,
  lerArgs,
} from "../../../scripts/benchmark-variantes.mjs";

describe("lerArgs — arquivos de eventos por clipe", () => {
  it("usa minimos conservadores por padrao", () => {
    const args = lerArgs([]);
    expect(args.minCiclos).toBe(2);
    expect(args.minAmostrasEstatisticas).toBe(10);
  });

  it("aceita minimos explicitos de ciclos e amostras estatisticas", () => {
    const args = lerArgs(["--min-ciclos", "3", "--min-amostras-estatisticas", "20"]);
    expect(args.minCiclos).toBe(3);
    expect(args.minAmostrasEstatisticas).toBe(20);
  });

  it("associa cada caminho ao nome completo do clipe e à variante", () => {
    const args = lerArgs([
      "--eventos-B-car-detection.mp4",
      "logs/B-car.jsonl",
      "--eventos-C-fruit-and-vegetable-detection.mp4",
      "logs/C-fruit.jsonl",
    ]);
    expect(args.eventosPorClipeVariante).toMatchObject({
      B: { "car-detection.mp4": "logs/B-car.jsonl" },
      C: { "fruit-and-vegetable-detection.mp4": "logs/C-fruit.jsonl" },
    });
  });
});

// ---------------------------------------------------------------------------
// Identificacao de variante pelos registros de ciclo
// ---------------------------------------------------------------------------

describe("identificarVarianteDoRegistro", () => {
  it("reconhece cada variante pelo sessionId (B/C checados antes de D)", () => {
    expect(identificarVarianteDoRegistro({ sessionId: "sessao-variante-a", cycleId: "c1" })).toBe("A");
    expect(identificarVarianteDoRegistro({ sessionId: "sessao-variante-b", cycleId: "c1" })).toBe("B");
    expect(identificarVarianteDoRegistro({ sessionId: "percepcao-sequencia-42", cycleId: "c1" })).toBe("B");
    expect(identificarVarianteDoRegistro({ sessionId: "sessao-variante-c", cycleId: "c1" })).toBe("C");
    expect(identificarVarianteDoRegistro({ sessionId: "percepcao-fundida-42", cycleId: "c1" })).toBe("C");
    expect(identificarVarianteDoRegistro({ sessionId: "sessao-percepcao", cycleId: "c1" })).toBe("D");
    expect(identificarVarianteDoRegistro({ sessionId: "baseline-webcam", cycleId: "c1" })).toBe("A");
    expect(identificarVarianteDoRegistro({ sessionId: "qualquer-coisa", cycleId: "c1" })).toBeNull();
    expect(identificarVarianteDoRegistro(null)).toBeNull();
  });

  it("prioriza a variante efetiva gravada na configuração do ciclo", () => {
    expect(identificarVarianteDoRegistro({
      sessionId: "sessao-random",
      configuracao: { varianteId: "sequencia" },
    })).toBe("B");
    expect(identificarVarianteDoRegistro({
      sessionId: "sessao-random",
      configuracao: { varianteId: "fundida" },
    })).toBe("C");
    expect(identificarVarianteDoRegistro({
      sessionId: "sessao-random",
      configuracao: { varianteId: "completa" },
    })).toBe("D");
    expect(identificarVarianteDoRegistro({
      sessionId: "sessao-random",
      configuracao: { varianteId: "baseline" },
    })).toBe("A");
  });

  it("filtra registros por sessao explicita quando informada", () => {
    const registros = [
      { sessionId: "abc", cycleId: "c1" },
      { sessionId: "xyz", cycleId: "c2" },
    ];
    expect(filtrarCiclosDaVariante(registros, "B", "xyz")).toHaveLength(1);
    expect(filtrarCiclosDaVariante(registros, "B", undefined)).toHaveLength(0);
  });
});