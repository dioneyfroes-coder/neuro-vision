import { describe, expect, it } from "vitest";
import { ErroPercepcao, ehCancelamento } from "../src/erros";

describe("ehCancelamento", () => {
  it("reconhece AbortError e ErroPercepcao de cancelamento", () => {
    const abort = new Error("parado");
    abort.name = "AbortError";
    expect(ehCancelamento(abort)).toBe(true);
    expect(ehCancelamento(new ErroPercepcao("cancelamento", "parado"))).toBe(true);
  });

  it("rejeita erros comuns e de outras origens", () => {
    expect(ehCancelamento(new Error("x"))).toBe(false);
    expect(ehCancelamento(new ErroPercepcao("visao", "x"))).toBe(false);
    expect(ehCancelamento(null)).toBe(false);
    expect(ehCancelamento("texto")).toBe(false);
  });

  it("classifica a origem do erro", () => {
    const err = new ErroPercepcao("armazenamento", "HTTP 500");
    expect(err.origem).toBe("armazenamento");
    expect(err).toBeInstanceOf(Error);
  });
});