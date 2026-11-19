import { describe, expect, it } from "vitest";
import { montarOperacional } from "../../src/memoria";

describe("montarOperacional", () => {
  it("aplica padroes e aceita detalhe", () => {
    const registro = montarOperacional({ mensagem: "falha ao gravar" });
    expect(registro).toMatchObject({
      nivel: "info",
      origem: "cliente",
      mensagem: "falha ao gravar",
    });
    expect(registro?.timestamp).toBeTruthy();
  });

  it("rejeita mensagem ausente ou vazia", () => {
    expect(montarOperacional({})).toBeNull();
    expect(montarOperacional({ mensagem: "" })).toBeNull();
    expect(montarOperacional(null)).toBeNull();
  });
});
