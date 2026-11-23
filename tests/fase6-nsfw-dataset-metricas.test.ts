import { describe, expect, it } from "vitest";

import {
  normalizarEntradaDatasetNsfw,
  validarDatasetNsfw,
} from "../src/domain/dataset-nsfw";
import { calcularMetricasNsfwPorClasse } from "../src/domain/metricas-nsfw-por-classe";

/**
 * Estes dados são **declarativos** e exercitam apenas a validação do contrato.
 * Eles não são um dataset real, não provêm desempenho e não substituem
 * anotação humana revisada.
 */
const manifesto = { versaoEsquema: 1 };
const anotacaoTeste = {
  versaoEsquema: 2,
  conjunto: "teste" as const,
  revisao: { status: "revisada" },
  resolucaoMs: 200,
};

function entrada(split: "treino" | "tuning" | "teste", nome: string, hash: string) {
  return {
    split,
    clip: nome,
    sha256: hash,
    ...(split === "teste" ? { anotacao: anotacaoTeste } : {}),
  };
}

describe("Fase 6 — dataset separado e métricas por classe/modelo", () => {
  it("recusa manifesto ausente sem afirmar que o dataset existe", () => {
    const relatorio = validarDatasetNsfw(undefined);
    expect(relatorio.status).toBe("sem_dados");
    expect(relatorio.contagem.teste).toBe(0);
    expect(relatorio.prontosParaMetricas).toBe(false);
  });

  it("valida separação por nome e por hash e exige anotação revisada no teste", () => {
    const relatorio = validarDatasetNsfw(manifesto, [
      entrada("treino", "a.mp4", "a".repeat(64)),
      entrada("tuning", "b.mp4", "b".repeat(64)),
      entrada("teste", "c.mp4", "c".repeat(64)),
    ]);
    expect(relatorio.status).toBe("valido");
    expect(relatorio.contagem).toEqual({ treino: 1, tuning: 1, teste: 1 });
    expect(relatorio.hashesUnicos).toBe(3);
    expect(relatorio.prontosParaMetricas).toBe(true);
  });

  it("detecta vazamento entre splits por SHA-256 repetido", () => {
    const hash = "d".repeat(64);
    const relatorio = validarDatasetNsfw(manifesto, [
      entrada("treino", "a.mp4", hash),
      entrada("teste", "b.mp4", hash),
    ]);
    expect(relatorio.status).toBe("invalido");
    expect(relatorio.erros.join(" ")).toMatch(/SHA-256 repetido/);
    expect(relatorio.prontosParaMetricas).toBe(false);
  });

  it("rejeita mídia incorporada e caminhos absolutos no manifesto", () => {
    expect(normalizarEntradaDatasetNsfw({ split: "teste", clip: "a.mp4", base64: "..." }).erro)
      .toMatch(/campos de midia/);
    expect(normalizarEntradaDatasetNsfw({ split: "teste", clip: "../a.mp4", sha256: "e".repeat(64) }).erro)
      .toMatch(/somente o nome do arquivo/);
  });

  it("mantém precisão/recall/f1 em N/A sem anotação revisada", () => {
    const relatorio = calcularMetricasNsfwPorClasse(undefined, [{ classe: "A" }]);
    expect(relatorio.status).toBe("sem_dados");
    expect(relatorio.macro).toEqual({ precisao: null, recall: null, f1: null });
    expect(
      calcularMetricasNsfwPorClasse({ versaoEsquema: 1, conjunto: "teste", revisao: { status: "revisada" } }, [])
        .status
    ).toBe("sem_dados");
  });

  it("conta tp/fp/fn por clip/modelo/classe quando há anotação revisada", () => {
    const relatorio = calcularMetricasNsfwPorClasse(
      {
        versaoEsquema: 2,
        conjunto: "teste",
        revisao: { status: "revisada" },
        referencias: [
          { clip: "c1", modelo: "m", classe: "A" },
          { clip: "c1", modelo: "m", classe: "A" },
          { clip: "c2", modelo: "m", classe: "B" },
        ],
      },
      [
        { clip: "c1", modelo: "m", classe: "A" },
        { clip: "c2", modelo: "m", classe: "C" },
      ]
    );
    expect(relatorio.status).toBe("medido");
    expect(relatorio.base).toBe("anotacao-revisada");
    const a = relatorio.porModeloClasse.find((item) => item.clip === "c1" && item.classe === "A");
    expect(a).toMatchObject({ tp: 1, fp: 0, fn: 1, precisao: 1, recall: 0.5 });
    const c = relatorio.porModeloClasse.find((item) => item.clip === "c2" && item.classe === "C");
    expect(c).toMatchObject({ tp: 0, fp: 1, fn: 0, precisao: 0 });
    expect(c?.recall).toBeNull();
    expect(relatorio.macro.precisao).toBeCloseTo(0.5);
    expect(relatorio.macro.f1).not.toBeNull();
  });
});
