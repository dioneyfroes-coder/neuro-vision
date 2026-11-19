import { describe, expect, it } from "vitest";
import { carregarAnotacao, compararEventos } from "../../../scripts/avaliar-qualidade.mjs";
import { ev } from "../../helpers/avaliar-qualidade.mjs";

describe("carregarAnotacao", () => {
  it("normaliza o tipo para minusculas e mantem descricao", () => {
    const a = carregarAnotacao({
      clip: "sala.mp4",
      inicio: "2026-10-11T12:00:00.000Z",
      duracaoMs: 60000,
      eventos: [{ tipo: "Aparicao", em: 1000, descricao: "pessoa entra" }],
    });
    expect(a.eventos[0]).toEqual({ tipo: "aparicao", em: 1000, descricao: "pessoa entra" });
    expect(a.duracaoMs).toBe(60000);
  });

  it("rejeita tipo desconhecido", () => {
    expect(() => carregarAnotacao({ eventos: [{ tipo: "voando", em: 1 }] })).toThrow();
  });

  it("rejeita evento sem em", () => {
    expect(() => carregarAnotacao({ eventos: [{ tipo: "aparicao" }] })).toThrow();
  });

  it("rejeita em negativo", () => {
    expect(() => carregarAnotacao({ eventos: [{ tipo: "aparicao", em: -1 }] })).toThrow();
  });

  it("rejeita um array no lugar de um objeto", () => {
    expect(() => carregarAnotacao([])).toThrow();
  });

  it("valida intervalo e metadados da anotacao v2", () => {
    const a = carregarAnotacao({
      versaoEsquema: 2,
      conjunto: "eval",
      revisao: { status: "revisada", metodo: "quadro-a-quadro" },
      duracaoMs: 10000,
      eventos: [
        {
          tipo: "movimento",
          inicioMs: 2000,
          fimMs: 4000,
          categoria: "gesto",
          classe: "aceno",
          visibilidade: "clara",
          parteEnvolvida: "mao_direita",
          determinavel: true,
        },
      ],
    });
    expect(a.conjunto).toBe("eval");
    expect(a.revisao.status).toBe("revisada");
    expect(a.eventos[0]).toMatchObject({
      tipo: "movimento",
      em: 2000,
      inicioMs: 2000,
      fimMs: 4000,
      categoria: "gesto",
      classe: "aceno",
      visibilidade: "clara",
      parteEnvolvida: "mao_direita",
      determinavel: true,
    });
  });

  it("rejeita intervalo fora da duracao ou em invertido", () => {
    expect(() =>
      carregarAnotacao({
        duracaoMs: 1000,
        eventos: [{ tipo: "movimento", inicioMs: 800, fimMs: 1200 }],
      })
    ).toThrow('excede "duracaoMs"');
    expect(() =>
      carregarAnotacao({
        eventos: [{ tipo: "movimento", inicioMs: 800, fimMs: 200 }],
      })
    ).toThrow('"inicioMs" deve ser <= "fimMs"');
  });

  it("rejeita categorias e visibilidades fora do vocabulario", () => {
    expect(() =>
      carregarAnotacao({
        eventos: [{ tipo: "movimento", em: 100, categoria: "corrida" }],
      })
    ).toThrow("categoria desconhecida");
    expect(() =>
      carregarAnotacao({
        eventos: [{ tipo: "movimento", em: 100, visibilidade: "ruim" }],
      })
    ).toThrow("visibilidade desconhecida");
  });

  it("exige metadados completos e negativo explícito para EVAL v2", () => {
    expect(() =>
      carregarAnotacao({
        versaoEsquema: 2,
        conjunto: "eval",
        revisao: { status: "revisada", metodo: "quadro-a-quadro" },
        eventos: [],
      })
    ).toThrow('"casoNegativo": true');
    expect(() =>
      carregarAnotacao({
        versaoEsquema: 2,
        conjunto: "eval",
        revisao: { status: "revisada", metodo: "quadro-a-quadro" },
        eventos: [{ tipo: "movimento", em: 1 }],
      })
    ).toThrow("metadados humanos completos");
  });
});

describe("eventos indeterminados", () => {
  it("nao os inclui nas metricas de qualidade", () => {
    const r = compararEventos({
      esperados: [
        ev("aparicao", 5000),
        { ...ev("movimento", 10000), determinavel: false },
      ],
      detectados: [],
      duracaoMs: 60000,
    });
    expect(r.esperados).toBe(1);
    expect(r.indeterminados).toBe(1);
    expect(r.perdidos).toBe(1);
    expect(r.recall).toBe(0);
  });
});
