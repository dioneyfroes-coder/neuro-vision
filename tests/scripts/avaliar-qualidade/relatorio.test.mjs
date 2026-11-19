import { describe, expect, it } from "vitest";
import { compararEventos, formatarRelatorio } from "../../../scripts/avaliar-qualidade.mjs";
import { ev } from "../../helpers/avaliar-qualidade.mjs";

describe("formatarRelatorio", () => {
  it("inclui precisao, recall e falsos positivos por minuto", () => {
    const r = compararEventos({
      esperados: [ev("aparicao", 5000)],
      detectados: [ev("movimento", 5000)],
      duracaoMs: 60000,
    });
    const texto = formatarRelatorio(r, { clip: "x.mp4", toleranciaMs: 3000 });
    expect(texto).toContain("Clipe: x.mp4");
    expect(texto).toContain("Precisao: 0%");
    expect(texto).toContain("recall: 0%");
    expect(texto).toContain("Perdidas:");
    expect(texto).toContain("Falsos positivos:");
  });

  it("mostra N/A quando nao ha denominador para a metrica", () => {
    const r = compararEventos({
      esperados: [],
      detectados: [],
      duracaoMs: 0,
    });
    const texto = formatarRelatorio(r, { clip: "vazio.mp4", toleranciaMs: 3000 });
    expect(texto).toContain("Precisao: N/A");
    expect(texto).toContain("recall: N/A");
    expect(texto).toContain("falsos positivos/min: N/A");
  });
});
