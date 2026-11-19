import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extrairBase64,
  limparCacheModelo,
  montarPromptDescricao,
  montarPromptRoteiro,
  PROMPT_ANALISE_PROFUNDA,
  PROMPT_DESCRICAO,
  PROMPT_ROTEIRO_BASE,
  PROMPT_ROTEIRO_DELTA,
} from "../../src/visao";

afterEach(() => {
  vi.unstubAllGlobals();
  limparCacheModelo();
});

describe("extrairBase64", () => {
  it("remove o prefixo data URL", () => {
    expect(extrairBase64("data:image/jpeg;base64,AAAA")).toBe("AAAA");
  });

  it("mantem base64 puro", () => {
    expect(extrairBase64("AAAA")).toBe("AAAA");
  });
});

describe("prompts", () => {
  it("montarPromptDescricao devolve o prompt de descricao", () => {
    expect(montarPromptDescricao()).toBe(`${PROMPT_DESCRICAO}\n\n${PROMPT_ANALISE_PROFUNDA}`);
    expect(PROMPT_DESCRICAO).toContain("UMA foto");
    expect(montarPromptDescricao()).toContain("analise visual completa");
  });

  it("montarPromptRoteiro escolhe base ou delta", () => {
    expect(montarPromptRoteiro(true, "")).toBe(
      `${PROMPT_ROTEIRO_BASE}\n\n${PROMPT_ANALISE_PROFUNDA}`
    );
    expect(montarPromptRoteiro(false, "Pessoa de pe.")).toBe(
      `${PROMPT_ROTEIRO_DELTA}\n\n${PROMPT_ANALISE_PROFUNDA}`
    );
    expect(PROMPT_ROTEIRO_BASE).toContain("PRIMEIRO");
  });
});