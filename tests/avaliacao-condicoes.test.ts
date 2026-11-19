import { describe, expect, it } from "vitest";

import {
  avaliarCondicoes,
  CONDICOES_ALVO,
  ehCondicaoAlvo,
  sobreposicaoComAnotacao,
  type AnotacaoClipCondicoes,
  type CondicaoAlvo,
  type EventoCondicao,
} from "../src/domain/avaliacao-condicoes";

const ALVO: CondicaoAlvo = "oclusao_parcial";
const OPCOES = { condicoes: [ALVO] as const } as const;

/** Três positivos revisados + dois negativos: suficiente para o gate padrão. */
function base(revisada = true): AnotacaoClipCondicoes[] {
  const positivos = [1, 2, 3].map((n) => ({
    clip: `oclusao-${n}.mp4`,
    duracaoMs: 10_000,
    revisada,
    metodoRevisao: "quadro-a-quadro",
    eventos: [
      {
        condicao: ALVO,
        inicioMs: 2_000,
        fimMs: 4_000,
        determinavel: true,
        visibilidade: "parcial" as const,
      },
    ],
  }));
  const negativos = [1, 2].map((n) => ({
    clip: `negativo-${n}.mp4`,
    duracaoMs: 10_000,
    revisada,
    metodoRevisao: "quadro-a-quadro",
    eventos: [],
  }));
  return [...positivos, ...negativos];
}

function acertos(): EventoCondicao[] {
  return [1, 2, 3].map((n) => ({
    clip: `oclusao-${n}.mp4`,
    classe: "baixa_confianca" as const,
    emMs: 3_000,
    motivo: "baixa_confianca",
  }));
}

describe("avaliacao de condicoes (Fase 7)", () => {
  it("aprova com tres ocorrencias revisadas, negativos e politica correta", () => {
    const resultado = avaliarCondicoes(base(), acertos(), OPCOES);
    expect(resultado.veredito).toBe("APROVADO");
    expect(resultado.problemas).toEqual([]);
    expect(resultado.porCondicao[ALVO].acertos).toBe(3);
    expect(resultado.porCondicao[ALVO].falsosNegativos).toBe(0);
    expect(resultado.porCondicao[ALVO].falsosPositivos).toBe(0);
    expect(resultado.porCondicao[ALVO].precisao).toBe(1);
    expect(resultado.porCondicao[ALVO].recall).toBe(1);
    expect(resultado.porCondicao[ALVO].correspondencias).toHaveLength(3);
  });

  it("nao promove rascunho a aceite", () => {
    const resultado = avaliarCondicoes(base(false), acertos(), OPCOES);
    expect(resultado.veredito).toBe("INCONCLUSIVO");
    expect(resultado.problemas.join(" ")).toContain("nenhuma anotação revisada");
    // Rascunho não é verdade-base: nenhum número de acerto é produzido.
    expect(resultado.porCondicao[ALVO].recall).toBeNull();
    expect(resultado.porCondicao[ALVO].esperados).toBe(0);
  });

  it("ignora rascunhos mesmo quando há anotações revisadas suficientes", () => {
    const anotacoes = [...base()];
    anotacoes.push({
      clip: "rascunho.mp4",
      duracaoMs: 10_000,
      revisada: false,
      eventos: [{ condicao: ALVO, inicioMs: 0, fimMs: 1_000 }],
    });
    const resultado = avaliarCondicoes(anotacoes, acertos(), OPCOES);
    expect(resultado.veredito).toBe("INCONCLUSIVO");
    expect(resultado.problemas.join(" ")).toContain("em rascunho ignorada");
    expect(resultado.porCondicao[ALVO].esperados).toBe(3);
  });

  it("reprova quando a politica chama degradacao de movimento", () => {
    const eventos = [...acertos()];
    eventos[0] = {
      clip: "oclusao-1.mp4",
      classe: "movimento",
      emMs: 3_000,
      motivo: "movimento",
    };
    const resultado = avaliarCondicoes(base(), eventos, OPCOES);
    expect(resultado.veredito).toBe("REPROVADO");
    expect(resultado.porCondicao[ALVO].violacoesPolitica).toBe(1);
    expect(resultado.porCondicao[ALVO].falsosNegativos).toBe(1);
    expect(resultado.problemas.join(" ")).toContain("classificado(s) como movimento");
  });

  it("reprova recall abaixo do minimo sem transformar falha em pendencia", () => {
    const resultado = avaliarCondicoes(base(), acertos().slice(0, 1), OPCOES);
    expect(resultado.veredito).toBe("REPROVADO");
    expect(resultado.porCondicao[ALVO].falsosNegativos).toBe(2);
    expect(resultado.porCondicao[ALVO].recall).toBeCloseTo(1 / 3, 5);
  });

  it("conta falsos positivos por minuto e reprova acima do limite", () => {
    const eventos = [
      ...acertos(),
      { clip: "oclusao-1.mp4", classe: "baixa_confianca" as const, emMs: 9_000 },
      { clip: "oclusao-2.mp4", classe: "baixa_confianca" as const, emMs: 9_000 },
    ];
    const resultado = avaliarCondicoes(base(), eventos, OPCOES);
    expect(resultado.porCondicao[ALVO].falsosPositivos).toBe(2);
    // Cinco clipes de 10 s = 0,833 min; 2 FP => 2,4 FP/min.
    expect(resultado.porCondicao[ALVO].falsosPositivosPorMinuto).toBeCloseTo(2.4, 5);
    expect(resultado.veredito).toBe("REPROVADO");
  });

  it("exclui intervalos indeterminados de precisao e recall", () => {
    const anotacoes = base();
    anotacoes[0] = {
      ...anotacoes[0]!,
      eventos: [
        { condicao: ALVO, inicioMs: 2_000, fimMs: 4_000, determinavel: false },
        { condicao: ALVO, inicioMs: 6_000, fimMs: 8_000, determinavel: true },
      ],
    };
    const eventos = [...acertos()];
    eventos[0] = { clip: "oclusao-1.mp4", classe: "baixa_confianca", emMs: 7_000 };
    const resultado = avaliarCondicoes(anotacoes, eventos, OPCOES);
    expect(resultado.porCondicao[ALVO].indeterminados).toBe(1);
    expect(resultado.porCondicao[ALVO].esperados).toBe(4);
    expect(resultado.porCondicao[ALVO].falsosNegativos).toBe(0);
    expect(resultado.veredito).toBe("APROVADO");
  });

  it("exige todas as condicoes do manifesto", () => {
    const resultado = avaliarCondicoes(base(), acertos(), {});
    expect(resultado.veredito).toBe("INCONCLUSIVO");
    for (const condicao of CONDICOES_ALVO) {
      expect(resultado.porCondicao[condicao]).toBeDefined();
    }
    expect(resultado.problemas.join(" ")).toContain("contraluz: 0 ocorrência(s)");
  });

  it("sobreposicao tolera cadencia grossa e rejeita evento fora da janela", () => {
    const janela = { inicioMs: 2_000, fimMs: 4_000 };
    const dentro = { clip: "x", classe: "baixa_confianca" as const, emMs: 2_000 };
    const fora = { clip: "x", classe: "baixa_confianca" as const, emMs: 9_000 };
    expect(sobreposicaoComAnotacao(janela, dentro, 2_000)).toBeGreaterThanOrEqual(0.5);
    expect(sobreposicaoComAnotacao(janela, fora, 2_000)).toBe(0);
    expect(ehCondicaoAlvo("contraluz")).toBe(true);
    expect(ehCondicaoAlvo("outro")).toBe(false);
  });
});
