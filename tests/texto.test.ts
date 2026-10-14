import { describe, expect, it } from "vitest";
import { colapsarRepeticoes, cortarFraseIncompleta, ehSemMudanca, separarFrases } from "./texto";

describe("separarFrases", () => {
  it("quebra o texto em frases", () => {
    expect(separarFrases("Uma pessoa. Duas coisas! Tudo bem?")).toEqual([
      "Uma pessoa.",
      "Duas coisas!",
      "Tudo bem?",
    ]);
  });

  it("ignora espacos extras e vazio", () => {
    expect(separarFrases("  ")).toEqual([]);
    expect(separarFrases("")).toEqual([]);
  });
});

describe("colapsarRepeticoes", () => {
  it("remove frase repetida consecutiva", () => {
    expect(colapsarRepeticoes("Ola. Ola. Mundo.")).toBe("Ola. Mundo.");
  });

  it("colapsa um bloco de frases repetido varias vezes", () => {
    const bloco = "A pessoa esta com os bracos cruzados. A cama esta visivel.";
    const texto = Array(6).fill(bloco).join(" ");
    expect(colapsarRepeticoes(texto)).toBe(bloco);
  });

  it("colapsa repeticao alternada A B A B", () => {
    expect(colapsarRepeticoes("A. B. A. B.")).toBe("A. B.");
  });

  it("colapsa apenas o sufixo repetido preservando o prefixo", () => {
    expect(colapsarRepeticoes("Contexto novo. A. B. A. B.")).toBe("Contexto novo. A. B.");
  });

  it("mantem texto sem repeticoes intacto", () => {
    const texto = "Uma pessoa de pe. Usa camisa preta.";
    expect(colapsarRepeticoes(texto)).toBe(texto);
  });

  it("lida com texto vazio", () => {
    expect(colapsarRepeticoes("")).toBe("");
  });
});

describe("ehSemMudanca", () => {
  it("reconhece o sentinela INALTERADO (com e sem acento/caixa)", () => {
    expect(ehSemMudanca("INALTERADO")).toBe(true);
    expect(ehSemMudanca("inalterado.")).toBe(true);
  });

  it("tolera variacoes de escrita sem mudanca", () => {
    expect(ehSemMudanca("Sem mudança.")).toBe(true);
    expect(ehSemMudanca("SEM MUDAÇA.")).toBe(true);
    expect(ehSemMudanca("Nada mudou.")).toBe(true);
    expect(ehSemMudanca("")).toBe(true);
  });

  it("nao marca descricao real como sem mudanca", () => {
    expect(ehSemMudanca("A pessoa levantou o braco direito e sorriu.")).toBe(false);
    expect(
      ehSemMudanca("A cena continua igual em varios detalhes, mas a almofada azul apareceu agora no canto.")
    ).toBe(false);
  });
});

describe("cortarFraseIncompleta", () => {
  it("mantem texto que termina em pontuacao", () => {
    expect(cortarFraseIncompleta("Tudo bem. Tudo certo.")).toBe("Tudo bem. Tudo certo.");
  });

  it("remove fragmento final sem pontuacao", () => {
    expect(cortarFraseIncompleta("Primeira frase. Segunda frase. e um fragmento sem fim")).toBe(
      "Primeira frase. Segunda frase."
    );
  });

  it("mantem quando nao ha nenhuma pontuacao", () => {
    expect(cortarFraseIncompleta("sem pontuacao nenhuma")).toBe("sem pontuacao nenhuma");
  });

  it("lida com vazio", () => {
    expect(cortarFraseIncompleta("")).toBe("");
  });
});
