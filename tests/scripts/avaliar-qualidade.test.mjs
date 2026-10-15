import { describe, expect, it } from "vitest";
import {
  carregarAnotacao,
  compararEventos,
  formatarRelatorio,
  parsearEventos,
  resolverBaseMs,
  TIPOS_IGNORADOS_PADRAO,
} from "../../scripts/avaliar-qualidade.mjs";

const ev = (tipo, em, extra = {}) => ({ tipo, em, ...extra });

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

  it("conta deteccao sem mudanca esperada como falso positivo por minuto", () => {
    const r = compararEventos({
      esperados: [],
      detectados: [ev("movimento", 1000)],
      duracaoMs: 30000,
    });
    expect(r.falsosPositivos).toBe(1);
    expect(r.falsosPositivosPorMinuto).toBe(2);
    expect(r.precisao).toBe(0);
    expect(r.recall).toBe(1);
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
});

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
});

describe("resolverBaseMs", () => {
  it("prefere o sidecar ao inicio da anotacao", () => {
    const base = resolverBaseMs({
      inicioSidecar: "2026-10-11T14:49:51.315Z",
      inicio: "2026-10-11T00:00:00.000Z",
    });
    expect(base).toBe(Date.parse("2026-10-11T14:49:51.315Z"));
  });

  it("usa o inicio da anotacao quando nao ha sidecar", () => {
    const base = resolverBaseMs({ inicio: "2026-10-11T12:00:00.000Z" });
    expect(base).toBe(Date.parse("2026-10-11T12:00:00.000Z"));
  });

  it("usa o timestamp mais antigo quando nao ha inicio", () => {
    const base = resolverBaseMs({
      timestamps: ["2026-10-11T12:00:07.000Z", "2026-10-11T12:00:03.000Z"],
    });
    expect(base).toBe(Date.parse("2026-10-11T12:00:03.000Z"));
  });

  it("retorna 0 sem base e sem timestamps validos", () => {
    expect(resolverBaseMs({})).toBe(0);
    expect(resolverBaseMs({ timestamps: ["invalido"] })).toBe(0);
  });
});

describe("parsearEventos", () => {
  it("le JSONL e ignora linhas corrompidas ou incompletas", () => {
    const texto = [
      JSON.stringify({ timestamp: "2026-01-01T00:00:00.000Z", tipo: "aparicao", descricao: "x" }),
      "linha corrompida",
      JSON.stringify({ tipo: "sem-timestamp" }),
      "",
      JSON.stringify({ timestamp: "2026-01-01T00:00:05.000Z", tipo: "movimento" }),
    ].join("\n");
    const r = parsearEventos(texto);
    expect(r).toHaveLength(2);
    expect(r[0].descricao).toBe("x");
    expect(r[1].tipo).toBe("movimento");
  });
});

describe("formatarRelatorio", () => {
  it("inclui precisao, recall e falsos positivos por minuto", () => {
    const r = compararEventos({
      esperados: [ev("aparicao", 5000)],
      detectados: [ev("movimento", 5000)],
      duracaoMs: 60000,
    });
    const texto = formatarRelatorio(r, { clip: "x.mp4", toleranciaMs: 3000 });
    expect(texto).toContain("Clipe: x.mp4");
    expect(texto).toContain("Precisao: 0%");
    expect(texto).toContain("recall: 0%");
    expect(texto).toContain("Perdidas:");
    expect(texto).toContain("Falsos positivos:");
  });
});
