import { describe, expect, it } from "vitest";
import { agregarVisoes, inferenciasPorMinuto, montarAmbiente } from "../../scripts/benchmark.mjs";

describe("inferenciasPorMinuto", () => {
  it("respeita o intervalo minimo quando ele domina", () => {
    // total 2000 ms -> intervalo ceil(3000/1000)=3s -> espera 3000 ms -> 20/min
    expect(inferenciasPorMinuto(2000, 3)).toBe(20);
  });

  it("usa total + 500 ms quando maior que o intervalo", () => {
    expect(inferenciasPorMinuto(5000, 1)).toBeCloseTo(60000 / 5500, 1);
  });
});

describe("agregarVisoes", () => {
  it("faz a mediana entre imagens e recalcula o intervalo", () => {
    const r = agregarVisoes([
      { geracaoTokS: 10, prefillTokS: 100, primeiroMs: 1000, totalMs: 2000, tokens: 5, textoChars: 20 },
      { geracaoTokS: 20, prefillTokS: 200, primeiroMs: 3000, totalMs: 4000, tokens: 15, textoChars: 40 },
    ]);
    expect(r.geracaoTokS).toBe(15);
    expect(r.totalMs).toBe(3000);
    expect(r.intervaloMinSeg).toBe(5);
    expect(r.imagens).toBe(2);
  });

  it("ignora resultados sem visao ou sem resposta", () => {
    const r = agregarVisoes([
      { semVisao: true, geracaoTokS: 0 },
      { geracaoTokS: 12, prefillTokS: 120, primeiroMs: 800, totalMs: 1600, tokens: 8, textoChars: 30 },
    ]);
    expect(r.geracaoTokS).toBe(12);
    expect(r.imagens).toBe(1);
  });

  it("lida com lista vazia", () => {
    expect(agregarVisoes([])).toEqual({});
  });
});

describe("montarAmbiente", () => {
  it("registra hardware e versao do Node", () => {
    const ambiente = montarAmbiente();
    expect(ambiente.node).toMatch(/^v\d+/);
    expect(ambiente.nucleosLogicos).toBeGreaterThan(0);
    expect(typeof ambiente.cpu).toBe("string");
    expect(ambiente.memoriaTotalBytes).toBeGreaterThan(0);
  });
});
