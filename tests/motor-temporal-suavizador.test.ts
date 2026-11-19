import { describe, expect, it } from "vitest";
import { suavizarExponencial, medirMovimento, distanciaPontos } from "../public/temporal/suavizador";

// ---------------------------------------------------------------------------
// Suavizador e metricas
// ---------------------------------------------------------------------------

describe("suavizador", () => {
  it("suaviza exponencialmente e mede movimento", () => {
    expect(suavizarExponencial(0.5, 0, 1)).toBeCloseTo(0.5);
    expect(suavizarExponencial(0, 0, 1)).toBeCloseTo(1);
    expect(suavizarExponencial(1, 0, 1)).toBeCloseTo(0);
    expect(distanciaPontos({ x: 0, y: 0 }, { x: 3, y: 4 })).toBeCloseTo(5);
    const m = medirMovimento({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.2 });
    expect(m.deslocamentoY).toBeCloseTo(-0.3); // negativo = subindo
    expect(m.deslocamento).toBeCloseTo(0.3);
  });
});

// ---------------------------------------------------------------------------
// Rastreador de entidades: IDs estaveis e suavizacao
