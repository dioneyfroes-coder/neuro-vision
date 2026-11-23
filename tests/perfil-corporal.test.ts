import { describe, expect, it } from "vitest";
import {
  INSTRUCAO_CORPO_NEUTRO,
  INSTRUCAO_NSFW,
  blocoCorpoNeutro,
  blocoPerfilCorporal,
  normalizarPerfilDescricaoCorporal,
  resolverPerfilDescricaoCorporal,
} from "../src/nsfw-prompt";
import type { QuadroNsfwPrompt } from "../src/nsfw-prompt";

const quadro: QuadroNsfwPrompt = {
  indice: 1,
  frameId: "f1",
  marcacoes: [
    {
      rotulo: "male_breast_exposed",
      score: 0.62,
      caixa: { xmin: 0.1, ymin: 0.2, xmax: 0.4, ymax: 0.6 },
    },
  ],
};

describe("perfil de descricao corporal neutra (Fase 2)", () => {
  it("e um bloco independente, nao uma copia da instrucao NSFW", () => {
    expect(INSTRUCAO_CORPO_NEUTRO).toContain("DESCRICAO CORPORAL NEUTRA");
    expect(INSTRUCAO_CORPO_NEUTRO).toMatch(/roupa aberta|roupa de banho/);
    expect(INSTRUCAO_CORPO_NEUTRO).toMatch(/Nao sexualize|nao infera excitacao/i);
    expect(INSTRUCAO_CORPO_NEUTRO).not.toContain("CONTEUDO ADULTO");
    expect(INSTRUCAO_CORPO_NEUTRO).not.toContain("CLASSIFICADOR LOCAL");
    expect(INSTRUCAO_CORPO_NEUTRO).not.toMatch(/sem eufemismos/i);
    expect(INSTRUCAO_CORPO_NEUTRO).not.toMatch(/proibido recusar/i);
    expect(INSTRUCAO_NSFW).not.toContain(INSTRUCAO_CORPO_NEUTRO);
  });

  it("preserva o default: sem pedido explicito, NSFW desligado nao muda o prompt", () => {
    expect(resolverPerfilDescricaoCorporal(undefined, false)).toBe("sfw");
    expect(blocoPerfilCorporal("sfw", [quadro])).toBe("");
    expect(resolverPerfilDescricaoCorporal(undefined, true)).toBe("nsfw");
    expect(blocoPerfilCorporal("nsfw", [quadro])).toContain(INSTRUCAO_NSFW);
  });

  it("perfil explicito vence o toggle, permitindo comparar com os mesmos detectores", () => {
    expect(resolverPerfilDescricaoCorporal("neutro", true)).toBe("neutro");
    expect(resolverPerfilDescricaoCorporal("nsfw", false)).toBe("nsfw");
    expect(normalizarPerfilDescricaoCorporal("neutro")).toBe("neutro");
    expect(normalizarPerfilDescricaoCorporal("NSFW")).toBeUndefined();
    expect(normalizarPerfilDescricaoCorporal(null)).toBeUndefined();
  });

  it("emite o bloco neutro mesmo sem detector, com marcacoes como evidencia quando ha", () => {
    const semMarcacoes = blocoCorpoNeutro([]);
    expect(semMarcacoes).toContain(INSTRUCAO_CORPO_NEUTRO);
    expect(semMarcacoes).toContain("Sem marcacoes locais");

    const comMarcacoes = blocoCorpoNeutro([quadro], "clipe de praia");
    expect(comMarcacoes).toContain("CONTEXTO DECLARADO");
    expect(comMarcacoes).toContain("clipe de praia");
    expect(comMarcacoes).toContain("Imagem 1 (frameId f1)");
    expect(comMarcacoes).toMatch(/male_breast_exposed \(peitoral masculino exposto\) 0\.620/);
    expect(comMarcacoes).not.toContain(INSTRUCAO_NSFW);
  });
});
