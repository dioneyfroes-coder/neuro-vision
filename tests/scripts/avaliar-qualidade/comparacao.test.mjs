import { describe, expect, it } from "vitest";
import { compararEventos, TIPOS_IGNORADOS_PADRAO } from "../../../scripts/avaliar-qualidade.mjs";
import { ev } from "../../helpers/avaliar-qualidade.mjs";

describe("compararEventos", () => {
  it("conta verdadeiros positivos quando tipo e tempo batem", () => {
    const r = compararEventos({
      esperados: [ev("aparicao", 5000), ev("desaparecimento", 40000)],
      detectados: [ev("aparicao", 5100), ev("desaparecimento", 39800)],
      toleranciaMs: 3000,
      duracaoMs: 60000,
    });
    expect(r.verdadeirosPositivos).toBe(2);
    expect(r.perdidos).toBe(0);
    expect(r.falsosPositivos).toBe(0);
    expect(r.precisao).toBe(1);
    expect(r.recall).toBe(1);
    expect(r.proporcaoPerdidas).toBe(0);
  });

  it("marca mudanca esperada sem deteccao como perdida", () => {
    const r = compararEventos({
      esperados: [ev("aparicao", 5000)],
      detectados: [],
      duracaoMs: 60000,
    });
    expect(r.verdadeirosPositivos).toBe(0);
    expect(r.perdidos).toBe(1);
    expect(r.recall).toBe(0);
    expect(r.proporcaoPerdidas).toBe(1);
    expect(r.falsosPositivosPorMinuto).toBe(0);
  });

  it("avalia deslocamento de objetos sem confundir movimento de pessoa", () => {
    const r = compararEventos({
      esperados: [
        ev("movimento", 5000, {
          categoria: "movimento_objeto",
          classe: "objeto_deslocado",
        }),
        ev("desaparecimento", 7000, {
          categoria: "aparicao_desaparecimento",
          classe: "pessoa_saindo",
        }),
      ],
      detectados: [
        ev("movimento", 5100, { origensSinal: ["objetos"], rotuloObjeto: "bottle" }),
        ev("movimento", 5200, { origensSinal: ["objetos"], rotuloObjeto: "person" }),
        ev("movimento", 5300, { origensSinal: ["pose"], rotuloObjeto: "bottle" }),
        ev("movimento", 5400),
        ev("desaparecimento", 7100, { origensSinal: ["objetos"], rotuloObjeto: "person" }),
      ],
      escopoClasse: "movimento_objeto.objeto_deslocado",
      duracaoMs: 10000,
    });
    expect(r.escopoClasse).toBe("movimento_objeto.objeto_deslocado");
    expect(r.esperados).toBe(1);
    expect(r.foraEscopo).toBe(1);
    expect(r.indeterminados).toBe(0);
    expect(r.detectados).toBe(1);
    expect(r.semClassificacaoEscopo).toBe(2);
    expect(r.movimentosPessoaExcluidos).toBe(1);
    expect(r.verdadeirosPositivos).toBe(1);
    expect(r.falsosPositivos).toBe(0);
    expect(r.perdidos).toBe(0);
  });

  it("conta objeto deslocado sem anotacao como falso positivo no escopo", () => {
    const r = compararEventos({
      esperados: [],
      detectados: [
        ev("movimento", 1000, { origensSinal: ["objetos"], rotuloObjeto: "chair" }),
        ev("movimento", 2000, { origensSinal: ["objetos"], rotuloObjeto: "person" }),
      ],
      escopoClasse: "movimento_objeto.objeto_deslocado",
      duracaoMs: 60000,
    });
    expect(r.detectados).toBe(1);
    expect(r.falsosPositivos).toBe(1);
    expect(r.precisao).toBe(0);
    expect(r.semClassificacaoEscopo).toBe(0);
    expect(r.movimentosPessoaExcluidos).toBe(1);
  });

  it("conta deteccao sem mudanca esperada como falso positivo por minuto", () => {
    const r = compararEventos({
      esperados: [],
      detectados: [ev("movimento", 1000)],
      duracaoMs: 30000,
    });
    expect(r.falsosPositivos).toBe(1);
    expect(r.falsosPositivosPorMinuto).toBe(2);
    expect(r.precisao).toBe(0);
    // Sem mudancas esperadas nao ha denominador de recall: N/A, nao 1.
    expect(r.recall).toBeNull();
    expect(r.proporcaoPerdidas).toBeNull();
  });

  it("devolve N/A quando o denominador da metrica nao existe", () => {
    const semEsperados = compararEventos({
      esperados: [],
      detectados: [],
      duracaoMs: 0,
    });
    expect(semEsperados.precisao).toBeNull();
    expect(semEsperados.recall).toBeNull();
    expect(semEsperados.proporcaoPerdidas).toBeNull();
    expect(semEsperados.falsosPositivosPorMinuto).toBeNull();

    const soEsperados = compararEventos({
      esperados: [ev("aparicao", 5000)],
      detectados: [],
      toleranciaMs: 3000,
      duracaoMs: 60000,
    });
    // Ha esperados mas nenhuma deteccao: precisao sem denominador (N/A),
    // recall definido (0).
    expect(soEsperados.precisao).toBeNull();
    expect(soEsperados.recall).toBe(0);
    expect(soEsperados.falsosPositivosPorMinuto).toBe(0);
  });

  it("respeita a tolerancia nas bordas", () => {
    const base = { esperados: [ev("movimento", 5000)], detectados: [ev("movimento", 8000)] };
    expect(compararEventos({ ...base, toleranciaMs: 3000 }).verdadeirosPositivos).toBe(1);
    expect(compararEventos({ ...base, toleranciaMs: 2999 }).verdadeirosPositivos).toBe(0);
  });

  it("nao casa tipos diferentes", () => {
    const r = compararEventos({
      esperados: [ev("aparicao", 5000)],
      detectados: [ev("movimento", 5000)],
    });
    expect(r.verdadeirosPositivos).toBe(0);
    expect(r.perdidos).toBe(1);
    expect(r.falsosPositivos).toBe(1);
  });

  it('casa "qualquer" com qualquer tipo', () => {
    const r = compararEventos({
      esperados: [ev("qualquer", 5000)],
      detectados: [ev("mudanca_de_cena", 5200)],
    });
    expect(r.verdadeirosPositivos).toBe(1);
  });

  it("ignora eventos de resumo por padrao", () => {
    const r = compararEventos({
      esperados: [],
      detectados: [ev("resumo", 1000), ev("resumo", 2000)],
      duracaoMs: 60000,
    });
    expect(r.detectados).toBe(0);
    expect(r.falsosPositivos).toBe(0);
  });

  it("conta resumo como falso positivo quando nao ha ignorados", () => {
    const r = compararEventos({
      esperados: [],
      detectados: [ev("resumo", 1000)],
      ignorados: [],
      duracaoMs: 60000,
    });
    expect(r.falsosPositivos).toBe(1);
  });

  it("escolhe a deteccao mais proxima e descarta a outra", () => {
    const r = compararEventos({
      esperados: [ev("movimento", 5000)],
      detectados: [ev("movimento", 4000), ev("movimento", 5200)],
      toleranciaMs: 3000,
    });
    expect(r.correspondencias[0].detectado.em).toBe(5200);
    expect(r.falsosPositivos).toBe(1);
  });

  it("o padrao de ignorados e somente resumo", () => {
    expect(TIPOS_IGNORADOS_PADRAO).toEqual(["resumo"]);
  });

  it("deriva a duracao dos eventos quando ela nao e informada", () => {
    const r = compararEventos({
      esperados: [ev("aparicao", 0)],
      detectados: [ev("aparicao", 60000)],
      toleranciaMs: 100000,
    });
    expect(r.duracaoMs).toBe(60000);
    expect(r.falsosPositivosPorMinuto).toBe(0);
  });

  it("publica atraso com sinal, média e p95; sem amostra fica N/A", () => {
    const semAmostra = compararEventos({ esperados: [], detectados: [] });
    expect(semAmostra.atraso).toEqual({
      amostras: 0,
      mediaMs: null,
      p95Ms: null,
      minimoMs: null,
      maximoMs: null,
    });
    const r = compararEventos({
      esperados: [ev("interacao_objeto", 1000), ev("interacao_objeto", 2000)],
      detectados: [ev("interacao_objeto", 1300), ev("interacao_objeto", 1600)],
      toleranciaMs: 500,
    });
    expect(r.correspondencias.map((c) => c.atrasoMs)).toEqual([300, -400]);
    expect(r.atraso.amostras).toBe(2);
    expect(r.atraso.mediaMs).toBe(-50);
    expect(r.atraso.p95Ms).toBe(300);
    expect(r.atraso.minimoMs).toBe(-400);
    expect(r.atraso.maximoMs).toBe(300);
  });
});
