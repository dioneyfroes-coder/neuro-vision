import { describe, expect, it } from "vitest";
import { montarEvento } from "../../src/memoria";

describe("montarEvento", () => {
  it("normaliza um evento valido", () => {
    const evento = montarEvento({
      tipo: "aparicao",
      origem: "rastreador",
      descricao: "apareceu pessoa",
      objetoId: "obj-1",
      confianca: 0.9,
    });
    expect(evento).toMatchObject({
      tipo: "aparicao",
      origem: "rastreador",
      descricao: "apareceu pessoa",
      objetoId: "obj-1",
      confianca: 0.9,
    });
    expect(evento?.id).toBeTruthy();
    expect(evento?.timestamp).toBeTruthy();
  });

  it("rejeita tipo, origem ou descricao invalidos", () => {
    expect(montarEvento(null)).toBeNull();
    expect(montarEvento([])).toBeNull();
    expect(montarEvento({ tipo: "inexistente", origem: "rastreador", descricao: "x" })).toBeNull();
    expect(montarEvento({ tipo: "aparicao", origem: "quem", descricao: "x" })).toBeNull();
    expect(montarEvento({ tipo: "aparicao", origem: "rastreador" })).toBeNull();
  });

  it("normaliza a origem legada 'ollama' para 'visao'", () => {
    const evento = montarEvento({ tipo: "aparicao", origem: "ollama", descricao: "apareceu pessoa" });
    expect(evento?.origem).toBe("visao");
  });

  it("descarta confianca nao numerica", () => {
    const evento = montarEvento({
      tipo: "movimento",
      origem: "rastreador",
      descricao: "x",
      confianca: Number.NaN,
    });
    expect(evento?.confianca).toBeUndefined();
  });

  it("preserva sessaoId, frameId e idempotencyKey", () => {
    const evento = montarEvento({
      tipo: "aparicao",
      origem: "rastreador",
      descricao: "apareceu pessoa",
      sessaoId: "ses-1",
      frameId: "frame-1",
      idempotencyKey: "chave-1",
    });
    expect(evento).toMatchObject({
      sessaoId: "ses-1",
      frameId: "frame-1",
      idempotencyKey: "chave-1",
    });
  });

  it("preserva apenas as origens semanticas conhecidas", () => {
    const evento = montarEvento({
      tipo: "movimento",
      origem: "rastreador",
      descricao: "caneca se desloca",
      origensSinal: ["objetos", "origem-invalida"],
    });
    expect(evento?.origensSinal).toEqual(["objetos"]);
  });

  it("preserva o rotulo da entidade rastreada", () => {
    const evento = montarEvento({
      tipo: "movimento",
      origem: "rastreador",
      descricao: "garrafa se desloca",
      rotuloObjeto: "bottle",
    });
    expect(evento?.rotuloObjeto).toBe("bottle");
  });
});
