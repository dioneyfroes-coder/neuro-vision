import { describe, expect, it } from "vitest";
import { medirCustoMultimodal } from "../../src/domain/custo-multimodal";
import {
  agregarTelemetriaMultimodal,
  compararRespostasMultimodais,
  similaridadeAfirmacoes,
} from "../../src/domain/comparacao-multimodal";

describe("latência e custo por evento (Fase 6, item 7)", () => {
  const base = {
    cycleId: "c1",
    eventoIds: ["ev1"],
    modelo: "modelo-local",
    duracaoMs: 120,
    latenciaAteRespostaMs: 900,
    registradoEm: "2026-11-22T12:00:00.000Z",
  };

  it("não inventa custo sem tabela de preços", () => {
    const registro = medirCustoMultimodal({ ...base, tokens: 100 });
    expect(registro.custoEstimado).toBeUndefined();
    expect(registro.motivoCustoIndisponivel).toBe("tabela_precos_ausente");
    expect(registro.duracaoMs).toBe(120);
    expect(registro.eventoIds).toEqual(["ev1"]);
  });

  it("não transforma total de tokens em preço estimado", () => {
    const registro = medirCustoMultimodal({
      ...base,
      tokens: 100,
      precos: { entradaPorMilhao: 1, saidaPorMilhao: 2, moeda: "USD" },
    });
    expect(registro.motivoCustoIndisponivel).toBe("sem_divisao_entrada_saida");
    expect(registro.custoEstimado).toBeUndefined();
  });

  it("calcula estimativa somente com entrada/saída medidas", () => {
    const registro = medirCustoMultimodal({
      ...base,
      tokensEntrada: 1000,
      tokensSaida: 500,
      precos: { entradaPorMilhao: 2, saidaPorMilhao: 4, moeda: "USD" },
    });
    expect(registro.custoEstimado).toBeCloseTo(0.004);
    expect(registro.moeda).toBe("USD");
    expect(registro.motivoCustoIndisponivel).toBeUndefined();
  });
});

describe("comparação com anotação humana (Fase 6, item 8)", () => {
  const respostas = [
    {
      cycleId: "c1",
      resumo: "pessoa entra pela direita",
      acoes: [{ descricao: "pessoa entra pela direita", natureza: "observada" }],
      evidencias: ["f1"],
      evidenciasInvalidas: ["f999"],
      duracaoMs: 100,
      tokens: 50,
    },
    {
      cycleId: "c2",
      resumo: "a cena continua",
      acoes: [{ descricao: "pessoa sai pela esquerda" }],
      duracaoMs: 200,
      tokens: 70,
    },
  ];

  it("comparação léxica ignora acentos e artigos", () => {
    expect(similaridadeAfirmacoes("Pessoa entra pela direita", "pessoa entrando a direita")).toBeGreaterThan(0.4);
  });

  it("mantém taxas como N/A sem anotação revisada de avaliação", () => {
    const relatorio = compararRespostasMultimodais(
      {
        clip: "exemplo",
        conjunto: "tuning",
        revisao: { status: "rascunho" },
        afirmacoesEsperadas: [{ texto: "pessoa entra pela direita" }, { texto: "pessoa sai pela esquerda" }],
      },
      respostas
    );
    expect(relatorio.acertos).toBe(2);
    expect(relatorio.precisao).toBeUndefined();
    expect(relatorio.recall).toBeUndefined();
    expect(relatorio.motivoMetricasIndisponiveis).toBeDefined();
  });

  it("só informa taxas quando há anotação revisada de eval", () => {
    const relatorio = compararRespostasMultimodais(
      {
        clip: "exemplo",
        conjunto: "eval",
        revisao: { status: "revisada", metodo: "revisão humana" },
        afirmacoesEsperadas: [{ texto: "pessoa entra pela direita" }, { texto: "pessoa sai pela esquerda" }],
      },
      respostas
    );
    expect(relatorio.precisao).toBe(1);
    expect(relatorio.recall).toBe(1);
    expect(relatorio.extras).toEqual([]);
    expect(relatorio.evidenciasInvalidas).toBe(1);
  });

  it("agrega apenas telemetria medida", () => {
    const telemetria = agregarTelemetriaMultimodal(respostas);
    expect(telemetria.latenciaMs).toEqual({ amostras: 2, media: 150, max: 200 });
    expect(telemetria.tokens).toEqual({ amostras: 2, total: 120, medio: 60 });
    expect(agregarTelemetriaMultimodal([{}]).latenciaMs.amostras).toBe(0);
  });
});
