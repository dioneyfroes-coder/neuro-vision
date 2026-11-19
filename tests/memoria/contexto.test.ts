import { describe, expect, it } from "vitest";
import { reidratarContexto, resumirContexto } from "../../src/memoria";
import type { EventoVisual } from "../../src/types";
import { entradaMemoria } from "../helpers/memoria";

describe("resumirContexto", () => {
  it("resume descricoes, objetos vistos e eventos", () => {
    const entradas = [
      entradaMemoria({ tipo: "descricao", resumo: "Uma pessoa na sala." }),
      entradaMemoria({
        tipo: "deteccao",
        objetos: [
          { nome: "pessoa", rotulo: "person", score: 0.9, caixa: { xmin: 0, ymin: 0, xmax: 1, ymax: 1 } },
        ],
      }),
    ];
    const eventos: EventoVisual[] = [
      { id: "e1", timestamp: "t", tipo: "aparicao", descricao: "apareceu pessoa", origem: "rastreador" },
    ];
    const contexto = resumirContexto(entradas, eventos);
    expect(contexto.resumo).toContain("Descricoes recentes: Uma pessoa na sala.");
    expect(contexto.resumo).toContain("Objetos vistos: pessoa");
    expect(contexto.resumo).toContain("Eventos recentes: apareceu pessoa");
    expect(contexto.entradas).toHaveLength(2);
    expect(contexto.eventos).toHaveLength(1);
  });

  it("respeita os limites de contagem e de caracteres", () => {
    const entradas = Array.from({ length: 10 }, (_, i) =>
      entradaMemoria({ tipo: "descricao", resumo: `descricao ${i}` })
    );
    const contexto = resumirContexto(entradas, [], { maxEntradas: 3, maxCaracteres: 20 });
    expect(contexto.entradas).toHaveLength(3);
    expect(contexto.resumo.length).toBeLessThanOrEqual(20);
  });

  it("produz resumo vazio quando nao ha dados", () => {
    const contexto = resumirContexto([], []);
    expect(contexto.resumo).toBe("");
    expect(contexto.entradas).toEqual([]);
    expect(contexto.eventos).toEqual([]);
  });
});

describe("reidratarContexto", () => {
  it("reconstroi roteiro e ultima descricao a partir do historico (mais novo primeiro)", () => {
    const entradas = [
      entradaMemoria({ tipo: "roteiro", papel: "delta", resumo: "passo 2" }),
      entradaMemoria({ tipo: "roteiro", papel: "delta", resumo: "passo 1" }),
      entradaMemoria({ tipo: "roteiro", papel: "base", resumo: "roteiro base" }),
      entradaMemoria({ tipo: "descricao", resumo: "pessoa na sala" }),
    ];
    const contexto = reidratarContexto(entradas, []);
    expect(contexto.roteiro).toEqual(["passo 1", "passo 2"]);
    expect(contexto.ultimaDescricao).toBe("passo 2");
    expect(contexto.resumo).toContain("pessoa na sala");
  });

  it("lida com historico vazio", () => {
    const contexto = reidratarContexto([], []);
    expect(contexto.roteiro).toEqual([]);
    expect(contexto.ultimaDescricao).toBe("");
    expect(contexto.resumo).toBe("");
  });

  it("respeita a janela maxima de entradas e caracteres", () => {
    const entradas = Array.from({ length: 10 }, (_, i) =>
      entradaMemoria({ tipo: "descricao", resumo: `descricao ${i}` })
    );
    const contexto = reidratarContexto(entradas, [], { maxEntradas: 2, maxCaracteres: 30 });
    expect(contexto.entradas).toHaveLength(2);
    expect(contexto.resumo.length).toBeLessThanOrEqual(30);
  });
});
