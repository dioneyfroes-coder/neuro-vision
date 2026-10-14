import { describe, expect, it } from "vitest";
import {
  CONFIG_MUDANCA_DE_CENA_PADRAO,
  DetectorMudancaDeCena,
  diferencaDeCena,
} from "../src/cena";

const base = [10, 10, 10, 10];

describe("diferencaDeCena", () => {
  it("retorna 0 para assinaturas iguais e 1 para opostas", () => {
    expect(diferencaDeCena(base, base)).toBe(0);
    expect(diferencaDeCena([0, 0, 0, 0], [255, 255, 255, 255])).toBeCloseTo(1);
  });

  it("lida com listas vazias sem dividir por zero", () => {
    expect(diferencaDeCena([], [])).toBe(0);
  });
});

describe("DetectorMudancaDeCena", () => {
  it("nao emite evento no primeiro frame (apenas registra a base)", () => {
    const d = new DetectorMudancaDeCena();
    expect(d.avaliar(base, 1000)).toBeNull();
  });

  it("emite mudanca_de_cena como sinal acima do limiar", () => {
    const d = new DetectorMudancaDeCena({ limiarDiferenca: 0.2 });
    d.avaliar(base, 1000);
    const evento = d.avaliar([200, 200, 200, 200], 2000);
    expect(evento?.tipo).toBe("mudanca_de_cena");
    expect(evento?.origem).toBe("detector");
    expect(evento?.confianca).toBeGreaterThan(0.2);
    expect(evento?.descricao).toContain("sinal");
  });

  it("ignora variacoes pequenas (camera parada)", () => {
    const d = new DetectorMudancaDeCena({ limiarDiferenca: 0.2 });
    d.avaliar([100, 100, 100, 100], 1000);
    expect(d.avaliar([110, 100, 100, 100], 2000)).toBeNull();
  });

  it("respeita o intervalo minimo entre eventos (evita repeticoes)", () => {
    const d = new DetectorMudancaDeCena({
      limiarDiferenca: 0.2,
      intervaloMinimoMs: 5000,
    });
    d.avaliar([0, 0, 0, 0], 1000);
    expect(d.avaliar([255, 255, 255, 255], 2000)).not.toBeNull();
    // Segunda mudanca forte, mas dentro da janela de throttle.
    expect(d.avaliar([0, 0, 0, 0], 3000)).toBeNull();
    expect(d.avaliar([255, 255, 255, 255], 8000)).not.toBeNull();
  });

  it("assinatura nula nao quebra e nao emite evento", () => {
    const d = new DetectorMudancaDeCena();
    expect(d.avaliar(null, 1000)).toBeNull();
    expect(d.avaliar(base, 2000)).toBeNull();
  });

  it("reiniciar volta a exigir base e limpa o throttle", () => {
    const d = new DetectorMudancaDeCena({
      limiarDiferenca: 0.2,
      intervaloMinimoMs: 5000,
    });
    d.avaliar([0, 0, 0, 0], 1000);
    d.avaliar([255, 255, 255, 255], 2000);
    d.reiniciar();
    expect(d.avaliar([255, 255, 255, 255], 2100)).toBeNull();
    expect(d.avaliar([0, 0, 0, 0], 8000)).not.toBeNull();
  });

  it("expoe a configuracao padrao esperada", () => {
    expect(CONFIG_MUDANCA_DE_CENA_PADRAO.limiarDiferenca).toBeGreaterThan(0);
    expect(CONFIG_MUDANCA_DE_CENA_PADRAO.intervaloMinimoMs).toBeGreaterThan(0);
  });
});
