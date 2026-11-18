import { describe, expect, it } from "vitest";
import { priorizarDeteccoes } from "../public/interpretation/proximidade-objetos";
import {
  NOMES_KEYPOINTS_COCO,
  type DeteccaoObservada,
  type MaoObservada,
  type PessoaObservada,
} from "../public/interpretation/esquema";

function deteccao(rotulo: string, x: number, y: number, score = 0.8): DeteccaoObservada {
  return {
    label: rotulo,
    rotulo,
    score,
    caixa: { xmin: x - 0.05, ymin: y - 0.05, xmax: x + 0.05, ymax: y + 0.05 },
    trackId: `obj-${rotulo}`,
  };
}

const maos: MaoObservada[] = [
  {
    indice: 1,
    lateralidade: "direita",
    landmarks: [{ nome: "punho", x: 0.5, y: 0.6 }],
    landmarksCompletos: false,
  },
];

const pessoas: PessoaObservada[] = [
  {
    indice: 1,
    keypoints: NOMES_KEYPOINTS_COCO.map((nome) => ({ nome, x: 0.3, y: 0.4, confianca: 0.9 })),
  },
];

describe("priorizarDeteccoes (Fase 4, item 4)", () => {
  it("ordena por mao, corpo e contexto sem descartar nenhum objeto", () => {
    const entradas = [
      deteccao("distante", 0.95, 0.95),
      deteccao("perto-corpo", 0.3, 0.4),
      deteccao("perto-mao", 0.5, 0.6),
    ];
    const ordem = priorizarDeteccoes(entradas, maos, pessoas);
    expect(ordem.map((item) => item.rotulo)).toEqual([
      "perto-mao",
      "perto-corpo",
      "distante",
    ]);
    expect(ordem[0].proximidade).toMatchObject({ prioridade: "mao", mao: 0 });
    expect(ordem[1].proximidade).toMatchObject({ prioridade: "corpo", corpo: 0 });
    expect(ordem[2].proximidade).toMatchObject({ prioridade: "contexto" });
    expect(entradas.map((item) => item.rotulo)).toEqual([
      "distante",
      "perto-corpo",
      "perto-mao",
    ]);
    expect(entradas[0].proximidade).toBeUndefined();
  });

  it("sem maos e sem pose preserva a ordem e nao inventa evidencia de proximidade", () => {
    const entradas = [
      deteccao("a", 0.1, 0.1, 0.5),
      deteccao("b", 0.9, 0.9, 0.9),
    ];
    const ordem = priorizarDeteccoes(entradas, [], []);
    expect(ordem.map((item) => item.rotulo)).toEqual(["a", "b"]);
    expect(ordem.every((item) => item.proximidade?.prioridade === "contexto")).toBe(true);
    expect(ordem.every((item) => item.proximidade?.mao === undefined)).toBe(true);
  });

  it("desempata por score e, em seguida, pela ordem original", () => {
    const entradas = [
      deteccao("baixo", 0.9, 0.9, 0.2),
      deteccao("alto", 0.9, 0.9, 0.9),
      deteccao("outro-alto", 0.9, 0.9, 0.9),
    ];
    const ordem = priorizarDeteccoes(entradas, maos, pessoas);
    expect(ordem.map((item) => item.rotulo)).toEqual([
      "alto",
      "outro-alto",
      "baixo",
    ]);
  });

  it("respeita raios configurados sem transformar proximidade em contato", () => {
    const entradas = [deteccao("borda", 0.4, 0.5)];
    const padrao = priorizarDeteccoes(entradas, maos, pessoas);
    expect(padrao[0].proximidade?.prioridade).toBe("mao");

    const estreito = priorizarDeteccoes(entradas, maos, pessoas, { raioMao: 0.05 });
    expect(estreito[0].proximidade).toMatchObject({
      prioridade: "corpo",
      mao: 0.14,
    });
  });
});
