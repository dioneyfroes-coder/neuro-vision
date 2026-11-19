import { describe, expect, it } from "vitest";
import { normalizarInterpretacao } from "../../public/interpretation/normalizar";

describe("normalizarInterpretacao", () => {
  it("extrai JSON estruturado e devolve ResultadoInterpretacao valido", () => {
    const json = '{"resumo": "A pessoa levantou o braco","acoes":[{"descricao":"levantar braco","inicioEm":"2026-10-17T12:00:00.000Z","evidencias":["f1"]}],"evidencias":["f1"],"incertezas":[],"contradicacoes":[]}';
    const res = normalizarInterpretacao(json, "qwen2.5-vl");
    expect(res.resumo).toBe("A pessoa levantou o braco");
    expect(res.acoes).toHaveLength(1);
    expect(res.evidencias).toEqual(["f1"]);
    expect(res.modelo).toBe("qwen2.5-vl");
  });

  it("normaliza tipo/natureza/confianca de acao e descarta valores invalidos", () => {
    const json =
      '{"resumo":"x","acoes":[' +
      '{"descricao":"masturbacao","tipo":"masturbacao","natureza":"inferida","confianca":1.7,"evidencias":["f1","f2"]},' +
      '{"descricao":"outra","tipo":"inventado","natureza":"certeza","confianca":"alta","evidencias":[]}' +
      '],"evidencias":[],"incertezas":[],"contradicoes":[]}';
    const res = normalizarInterpretacao(json);
    expect(res.acoes[0]).toMatchObject({
      tipo: "masturbacao",
      natureza: "inferida",
      confianca: 1,
    });
    expect(res.acoes[1].tipo).toBeUndefined();
    expect(res.acoes[1].natureza).toBeUndefined();
    expect(res.acoes[1].confianca).toBeUndefined();
  });

  it("extrai JSON em bloco fenced", () => {
    const texto = '```json\n{"resumo":"x","acoes":[],"evidencias":[],"incertezas":[],"contradicacoes":[]}\n```';
    const res = normalizarInterpretacao(texto);
    expect(res.resumo).toBe("x");
  });

  it("devolve bruto e incerteza quando nao e JSON valido", () => {
    const res = normalizarInterpretacao("texto puro sem estrutura", "m1");
    expect(res.bruto).toBe("texto puro sem estrutura");
    expect(res.resumo).toBe("texto puro sem estrutura");
    expect(res.incertezas).toEqual(["resposta nao estruturada"]);
    expect(res.modelo).toBe("m1");
  });

  it("normaliza participantes e preserva identidade apenas quando declarada", () => {
    const json = JSON.stringify({
      resumo: "duas pessoas na cena",
      acoes: [],
      participantes: [
        {
          descricao: "homem adulto",
          apresentacao: "Masculina",
          identidadeDeclarada: "homem",
          evidencias: ["f1"],
        },
        {
          descricao: "pessoa adulta",
          apresentacao: "invalida",
          identidadeDeclarada: "trans",
          evidencias: [],
        },
      ],
      evidencias: ["f1"],
      incertezas: [],
      contradicoes: [],
    });
    const res = normalizarInterpretacao(json);
    expect(res.participantes).toEqual([
      {
        descricao: "homem adulto",
        apresentacao: "masculina",
        identidadeDeclarada: "homem",
        evidencias: ["f1"],
      },
      { descricao: "pessoa adulta", apresentacao: "nao_identificada", evidencias: [] },
    ]);
  });

  it("devolve lista vazia de participantes quando o campo esta ausente", () => {
    const res = normalizarInterpretacao(
      '{"resumo":"x","acoes":[],"evidencias":[],"incertezas":[],"contradicoes":[]}'
    );
    expect(res.participantes).toEqual([]);
  });
});