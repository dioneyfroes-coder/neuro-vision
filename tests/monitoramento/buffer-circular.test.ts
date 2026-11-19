import { describe, expect, it } from "vitest";
import { BufferCircularQuadros } from "../../src/monitoramento/buffer-circular";
import { motivoRejeicao } from "../helpers/monitoramento";

describe("BufferCircularQuadros", () => {
  it("retem por tempo de captura, mantendo o limite inclusivo", () => {
    const buffer = new BufferCircularQuadros<number>({ retencaoMs: 5000 });
    for (const ms of [0, 1000, 5000, 10_000]) buffer.adicionar(ms, ms);

    expect(buffer.instantaneo().map((quadro) => quadro.capturadoEmMs)).toEqual([5000, 10_000]);
    expect(buffer.maisAntigoMs).toBe(5000);
    expect(buffer.maisRecenteMs).toBe(10_000);

    buffer.adicionar(10_001, 10_001);
    expect(buffer.instantaneo().map((quadro) => quadro.capturadoEmMs)).toEqual([10_000, 10_001]);
  });

  it("respeita o teto de capacidade descartando o mais antigo", () => {
    const buffer = new BufferCircularQuadros<string>({
      retencaoMs: 60_000,
      capacidadeMaxima: 2,
    });
    buffer.adicionar("a", 0);
    buffer.adicionar("b", 1000);
    buffer.adicionar("c", 2000);

    expect(buffer.instantaneo().map((quadro) => quadro.item)).toEqual(["b", "c"]);
    expect(buffer.tamanho).toBe(2);
  });

  it("rejeita fora de ordem e tempo invalido sem alterar a janela", () => {
    const buffer = new BufferCircularQuadros<number>({ retencaoMs: 5000 });
    buffer.adicionar(1, 1000);

    expect(motivoRejeicao(() => buffer.adicionar(2, 900))).toBe("fora_de_ordem");
    expect(motivoRejeicao(() => buffer.adicionar(3, Number.NaN))).toBe("tempo_invalido");
    expect(buffer.tamanho).toBe(1);
    expect(buffer.instantaneo()[0]).toEqual({ item: 1, capturadoEmMs: 1000 });
  });

  it("devolve copia defensiva da janela e dos itens quando ha clonagem", () => {
    const buffer = new BufferCircularQuadros<{ valor: number }>({
      retencaoMs: 5000,
      clonarItem: (item) => ({ ...item }),
    });
    const original = { valor: 1 };
    buffer.adicionar(original, 0);
    original.valor = 99;

    const primeiro = buffer.instantaneo();
    expect(primeiro[0].item.valor).toBe(1);
    primeiro[0].item.valor = 42;
    primeiro.push({ item: { valor: 7 }, capturadoEmMs: 1 });

    const segundo = buffer.instantaneo();
    expect(segundo).toHaveLength(1);
    expect(segundo[0].item.valor).toBe(1);

    buffer.limpar();
    expect(buffer.tamanho).toBe(0);
    expect(buffer.maisRecenteMs).toBeUndefined();
  });

  it("valida a configuracao do buffer", () => {
    expect(() => new BufferCircularQuadros<number>({ retencaoMs: 0 })).toThrow("retencaoMs");
    expect(
      () => new BufferCircularQuadros<number>({ retencaoMs: 1000, capacidadeMaxima: 0 })
    ).toThrow("capacidadeMaxima");
    expect(
      () => new BufferCircularQuadros<number>({ retencaoMs: 1000, capacidadeMaxima: 1.5 })
    ).toThrow("capacidadeMaxima");
  });
});
