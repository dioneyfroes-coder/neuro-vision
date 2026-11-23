import { describe, expect, it } from "vitest";
import {
  classificarMarcacoesNsfw,
  classificarRotuloNsfw,
  contemPropostaCena,
  ePropostaCena,
  INSTRUCAO_PROPOSTA_CENA_NSFW,
} from "../src/domain/nsfw-classificacao-rotulo";

describe("classificação anatomia × ação (Fase 4)", () => {
  it("trata make_love como proposta de cena, nunca confirmação", () => {
    const classificacao = classificarRotuloNsfw("make_love");
    expect(classificacao).toEqual({
      tipo: "acao",
      escopo: "cena",
      usoPermitido: "proposta_temporal",
      origem: "vocabulario_catalogo",
      confiavel: true,
    });
    expect(ePropostaCena({ classificacao })).toBe(true);
    expect(INSTRUCAO_PROPOSTA_CENA_NSFW).toContain("PROPOSTAS DE CENA");
    expect(INSTRUCAO_PROPOSTA_CENA_NSFW).toContain("nunca confirmacao");
  });

  it("separa anatomia local de estado visual e de rótulos desconhecidos", () => {
    expect(classificarRotuloNsfw("MALE_GENITALIA_EXPOSED")).toMatchObject({
      tipo: "anatomia",
      escopo: "local",
      usoPermitido: "localizacao",
      confiavel: true,
    });
    expect(classificarRotuloNsfw("female_genitalia_covered")).toMatchObject({
      tipo: "anatomia",
      usoPermitido: "localizacao",
    });
    expect(classificarRotuloNsfw("sexy")).toMatchObject({
      tipo: "estado_visual",
      usoPermitido: "sinal_auxiliar",
    });
    expect(classificarRotuloNsfw("rotulo_novo_do_sidecar")).toMatchObject({
      tipo: "regiao_corporal",
      usoPermitido: "sinal_auxiliar",
      confiavel: false,
    });
  });

  it("anexa metadados sem tocar em score, caixa ou modelo", () => {
    const marcacoes = [
      { rotulo: "make_love", score: 0.35, caixa: { xmin: 0, ymin: 0, xmax: 1, ymax: 1 }, modelo: "erax" },
      { rotulo: "penis", score: 0.8, caixa: { xmin: 0.1, ymin: 0.2, xmax: 0.3, ymax: 0.4 } },
    ];
    const classificadas = classificarMarcacoesNsfw(marcacoes);

    expect(classificadas.map((c) => c.classificacao.tipo)).toEqual(["acao", "anatomia"]);
    expect(classificadas[0].marcacao.score).toBe(0.35);
    expect(classificadas[0].marcacao.caixa).toEqual(marcacoes[0].caixa);
    expect(classificadas[0].marcacao.modelo).toBe("erax");
    expect(contemPropostaCena(marcacoes)).toBe(true);
    expect(contemPropostaCena([marcacoes[1]])).toBe(false);
  });
});
