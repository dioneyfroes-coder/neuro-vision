import { describe, expect, it } from "vitest";
import {
  blocoNsfwPrompt,
  formatarMarcacoesNsfw,
  INSTRUCAO_NSFW,
  normalizarCaixaNsfw,
  normalizarMarcacoesNsfw,
  resumirMarcacoesNsfw,
} from "../src/nsfw-prompt";

/**
 * Fase NSFW: o bloco compartilhado precisa preservar a informacao +18 e
 * instruir o modelo explicitamente, sem eufemismos/censura. As caixas saem dos
 * adaptadores em pixels e chegam ao log/prompt normalizadas em [0, 1].
 */
describe("normalizarCaixaNsfw", () => {
  it("converte pixels da imagem analisada em coordenadas normalizadas", () => {
    expect(
      normalizarCaixaNsfw(
        { xmin: 64, ymin: 48, xmax: 320, ymax: 240 },
        { largura: 640, altura: 480 }
      )
    ).toEqual({ xmin: 0.1, ymin: 0.1, xmax: 0.5, ymax: 0.5 });
  });

  it("limita a caixa a [0,1] e arredonda a 3 casas", () => {
    expect(
      normalizarCaixaNsfw(
        { xmin: -10, ymin: 60, xmax: 700, ymax: 480 },
        { largura: 640, altura: 480 }
      )
    ).toEqual({ xmin: 0, ymin: 0.125, xmax: 1, ymax: 1 });
  });

  it("sem dimensoes validas, trata a caixa como ja normalizada", () => {
    expect(
      normalizarCaixaNsfw({ xmin: 0.2, ymin: 0.3, xmax: 0.8, ymax: 0.9 })
    ).toEqual({ xmin: 0.2, ymin: 0.3, xmax: 0.8, ymax: 0.9 });
    expect(
      normalizarCaixaNsfw(
        { xmin: 2, ymin: -1, xmax: 3, ymax: 4 },
        { largura: 0, altura: 0 }
      )
    ).toEqual({ xmin: 1, ymin: 0, xmax: 1, ymax: 1 });
  });
});

describe("normalizarMarcacoesNsfw", () => {
  it("normaliza caixa e score das marcacoes", () => {
    const marcacoes = normalizarMarcacoesNsfw(
      [
        {
          rotulo: "porn",
          score: 0.8765,
          caixa: { xmin: 64, ymin: 48, xmax: 320, ymax: 240 },
        },
      ],
      { largura: 640, altura: 480 }
    );
    expect(marcacoes).toEqual([
      {
        rotulo: "porn",
        score: 0.877,
        caixa: { xmin: 0.1, ymin: 0.1, xmax: 0.5, ymax: 0.5 },
      },
    ]);
  });
});

describe("formatacao das marcacoes", () => {
  const marcacoes = [
    {
      rotulo: "porn",
      score: 0.87,
      caixa: { xmin: 0.1, ymin: 0.2, xmax: 0.5, ymax: 0.8 },
    },
    {
      rotulo: "sexy",
      score: 0.42,
      caixa: { xmin: 0.2, ymin: 0.3, xmax: 0.6, ymax: 0.9 },
    },
  ];

  it("formata rotulo, score e caixa normalizada", () => {
    expect(formatarMarcacoesNsfw(marcacoes)).toBe(
      "porn 0.870 caixa [0.1,0.2,0.5,0.8]; sexy 0.420 caixa [0.2,0.3,0.6,0.9]"
    );
    expect(formatarMarcacoesNsfw([])).toBe("nenhuma marcacao");
  });

  it("resume a contagem por rotulo", () => {
    expect(resumirMarcacoesNsfw([...marcacoes, marcacoes[0]])).toBe("2x porn, sexy");
    expect(resumirMarcacoesNsfw([])).toBe("nenhuma marcacao");
  });
});

describe("blocoNsfwPrompt", () => {
  it("instrui explicitamente a descrever conteudo adulto sem censura", () => {
    expect(INSTRUCAO_NSFW).toContain("CONTEUDO ADULTO (NSFW)");
    expect(INSTRUCAO_NSFW).toContain("explicita");
    expect(INSTRUCAO_NSFW).toContain("sem eufemismos");
    expect(INSTRUCAO_NSFW).toMatch(/proibido recusar a descricao/i);
    expect(INSTRUCAO_NSFW).toContain("Nao invente conteudo adulto");
  });

  it("lista as marcacoes por imagem/frame, inclusive quadro sem marcacao", () => {
    const bloco = blocoNsfwPrompt([
      {
        indice: 1,
        frameId: "f1",
        marcacoes: [
          {
            rotulo: "porn",
            score: 0.87,
            caixa: { xmin: 0.1, ymin: 0.2, xmax: 0.5, ymax: 0.8 },
          },
        ],
      },
      { indice: 2, frameId: "f2", marcacoes: [] },
    ]);
    expect(bloco).toContain(INSTRUCAO_NSFW);
    expect(bloco).toContain("Imagem 1 (frameId f1): porn 0.870");
    expect(bloco).toContain("Imagem 2 (frameId f2): nenhuma marcacao");
  });

  it("devolve vazio quando nao ha quadros", () => {
    expect(blocoNsfwPrompt([])).toBe("");
  });
});
