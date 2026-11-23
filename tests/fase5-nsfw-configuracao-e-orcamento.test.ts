import { describe, expect, it } from "vitest";
import {
  CONFIGURACAO_GEMMA_PADRAO,
  MODELO_NSFW,
  comporBlocosPrompt,
  deduparLinhasPrompt,
  descreverConfiguracaoGemma,
  normalizarConfiguracaoGemma,
  orcamentoTokensNsfw,
  limitesContextoDoOrcamento,
  normalizarPerfilOrcamentoNsfw,
  resolverConfiguracaoGemma,
  resolverModeloVisao,
} from "../src/nsfw-prompt";
import {
  avaliarDisponibilidadeGemma,
  erroLegivelGemma,
  mesmoModeloGemma,
  planoWarmupGemma,
} from "../src/domain/disponibilidade-gemma";

describe("Fase 5 — configuração centralizada do Gemma", () => {
  it("mantém o identificador histórico como padrão", () => {
    expect(MODELO_NSFW).toBe("gemma-4-e2b-uncensored-hauhaucs-aggressive");
    expect(CONFIGURACAO_GEMMA_PADRAO.modelo).toBe(MODELO_NSFW);
    expect(resolverConfiguracaoGemma().modelo).toBe(MODELO_NSFW);
  });

  it("normaliza sobrescrita parcial sem aceitar modelo vazio", () => {
    expect(
      resolverConfiguracaoGemma({
        modelo: "  gemma-local  ",
        versao: "v2",
        contextoMaximo: 8192,
      })
    ).toMatchObject({ modelo: "gemma-local", versao: "v2", contextoMaximo: 8192 });
    expect(normalizarConfiguracaoGemma({ modelo: "   " }).modelo).toBe(MODELO_NSFW);
    expect(normalizarConfiguracaoGemma({ contextoMaximo: -1 }).contextoMaximo).toBe(0);
  });

  it("descreve apenas dados declarados, sem inventar desempenho", () => {
    const texto = descreverConfiguracaoGemma(
      resolverConfiguracaoGemma({ quantizacao: "Q4", contextoMaximo: 4096 })
    );
    expect(texto).toContain(MODELO_NSFW);
    expect(texto).toContain("quantizacao Q4");
    expect(texto).toContain("contexto declarado 4096");
    expect(texto).not.toMatch(/latencia|precisao|recall/i);
  });

  it("NSFW continua forçando o Gemma; SFW preserva o modelo pedido", () => {
    expect(resolverModeloVisao("qwen2.5-vl-3b-instruct", true)).toBe(MODELO_NSFW);
    expect(resolverModeloVisao("qwen2.5-vl-3b-instruct", false)).toBe("qwen2.5-vl-3b-instruct");
    expect(resolverModeloVisao("qwen2.5-vl-3b-instruct", true, { modelo: "gemma-local" })).toBe(
      "gemma-local"
    );
  });
});

describe("Fase 5 — disponibilidade e warm-up do Gemma", () => {
  it("não afirma disponibilidade sem consulta ao backend", () => {
    const diagnostico = avaliarDisponibilidadeGemma({ modelo: MODELO_NSFW });
    expect(diagnostico.status).toBe("nao_verificado");
    expect(diagnostico.pronto).toBe(false);
    expect(erroLegivelGemma(diagnostico)).toContain("não verificado");
  });

  it("separa modelo não instalado de modelo instalado mas não carregado", () => {
    const ausente = avaliarDisponibilidadeGemma({
      modelo: MODELO_NSFW,
      online: true,
      modelos: ["qwen2.5-vl-3b-instruct"],
    });
    expect(ausente.status).toBe("indisponivel");
    expect(ausente.pronto).toBe(false);

    const pendente = avaliarDisponibilidadeGemma({
      modelo: MODELO_NSFW,
      online: true,
      modelos: [MODELO_NSFW],
    });
    expect(pendente.status).toBe("disponivel");
    expect(pendente.pronto).toBe(false);

    const pronto = avaliarDisponibilidadeGemma({
      modelo: MODELO_NSFW,
      online: true,
      modelos: [MODELO_NSFW],
      carregados: [MODELO_NSFW],
    });
    expect(pronto.pronto).toBe(true);
  });

  it("compara identificadores ignorando caixa e espaços", () => {
    expect(mesmoModeloGemma(" Gemma-Local ", "gemma-local")).toBe(true);
    expect(mesmoModeloGemma("", "")).toBe(false);
  });

  it("descreve as etapas do warm-up sem prometer sucesso", () => {
    const plano = planoWarmupGemma(MODELO_NSFW);
    expect(plano.modelo).toBe(MODELO_NSFW);
    expect(plano.etapas).toEqual([
      "consultar_modelos",
      "verificar_instalado",
      "forcar_carga",
      "verificar_memoria",
    ]);
    expect(plano.descricao).toContain("Independente da carga dos detectores locais");
  });
});

describe("Fase 5 — orçamento por perfil e composição do prompt", () => {
  it("usa limites históricos no perfil equilibrado", () => {
    expect(orcamentoTokensNsfw()).toEqual(orcamentoTokensNsfw("equilibrado"));
    expect(limitesContextoDoOrcamento(orcamentoTokensNsfw("equilibrado"))).toEqual({
      maxImagens: 4,
      maxEventos: 20,
      maxBytesContexto: 16_000,
    });
    expect(limitesContextoDoOrcamento(orcamentoTokensNsfw("leve")).maxImagens).toBe(2);
    expect(limitesContextoDoOrcamento(orcamentoTokensNsfw("completo")).maxImagens).toBe(8);
  });

  it("rejeita perfis desconhecidos sem cair em falso zero", () => {
    expect(normalizarPerfilOrcamentoNsfw("leve")).toBe("leve");
    expect(normalizarPerfilOrcamentoNsfw("pesado")).toBeUndefined();
  });

  it("remove apenas duplicatas exatas de linha", () => {
    const resultado = deduparLinhasPrompt(["A", "", "A", "B", "", "B"]);
    expect(resultado.linhas).toEqual(["A", "", "B", ""]);
    expect(resultado.duplicadas).toBe(2);
  });

  it("junta blocos sem alterar texto único e aplica teto quando pedido", () => {
    expect(comporBlocosPrompt(["linha 1", "linha 2"]).prompt).toBe("linha 1\n\nlinha 2");
    const cortado = comporBlocosPrompt(["abc", "def"], { maxCaracteres: 5 });
    expect(cortado.prompt).toBe("abc\n\n");
    expect(cortado.cortado).toBe(true);
  });
});
