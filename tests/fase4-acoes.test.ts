import { describe, expect, it } from "vitest";
import type { MudancaCena } from "../src/domain";
import {
  estadosDeMudancaCena,
  estadosObservadosParaEvento,
  naturezaInteracao,
  transicaoPosse,
} from "../src/domain";

/**
 * Regras puras do histórico de ações (Fase 4). Nenhuma delas inventa posse ou
 * estado físico a partir de falha, oclusão, lacuna ou hipótese.
 */
const BASE = {
  grau: "confirmado" as const,
  grauMaximo: "confirmado" as const,
  continuidadeValida: true,
  framesObjetoEstavel: 3,
  primeiroConfirmado: true,
};

function mudanca(overrides: Partial<MudancaCena> = {}): MudancaCena {
  return {
    mudancaId: "m1",
    sessaoId: "s1",
    tipo: "estado_alterado",
    objetoId: "obj-1",
    rotulo: "garrafa",
    confianca: 0.9,
    observado: true,
    detectadoEmMs: 1_700_000_000_500,
    referenciaEmMs: 1_700_000_000_000,
    estadoAnterior: "fechada",
    estadoAtual: "aberta",
    ...overrides,
  };
}

describe("naturezaInteracao", () => {
  it("separa proximidade, contato e manipulacao pelo que foi medido", () => {
    expect(naturezaInteracao({ grau: "incerto", framesSobreposicao: 0, objetoMoveu: false }, 3)).toBe(
      "proximidade"
    );
    expect(naturezaInteracao({ grau: "provavel", framesSobreposicao: 3, objetoMoveu: false }, 3)).toBe(
      "contato"
    );
    expect(
      naturezaInteracao({ grau: "confirmado", framesSobreposicao: 3, objetoMoveu: true }, 3)
    ).toBe("manipulacao");
  });
});

describe("transicaoPosse", () => {
  it("marca pego apenas na primeira promocao confirmada com continuidade", () => {
    expect(transicaoPosse(BASE, 3)).toBe("pego");
    expect(transicaoPosse({ ...BASE, primeiroConfirmado: false }, 3)).toBeUndefined();
    expect(transicaoPosse({ ...BASE, continuidadeValida: false }, 3)).toBeUndefined();
  });

  it("marca deixado somente apos afastamento observado com objeto estavel", () => {
    expect(
      transicaoPosse(
        {
          ...BASE,
          grau: "encerrado",
          motivoEncerramento: "sem_sinal",
          primeiroConfirmado: false,
        },
        3
      )
    ).toBe("deixado");
    expect(
      transicaoPosse({ ...BASE, grau: "encerrado", motivoEncerramento: "sem_sinal" }, 4)
    ).toBeUndefined();
  });

  it("oclusao, periodo cego e falha nunca viram deixado", () => {
    const encerrado = { ...BASE, grau: "encerrado" as const, primeiroConfirmado: false };
    expect(transicaoPosse({ ...encerrado, motivoEncerramento: "oclusao" }, 3)).toBeUndefined();
    expect(transicaoPosse({ ...encerrado, motivoEncerramento: "periodo_cego" }, 3)).toBeUndefined();
    expect(transicaoPosse({ ...encerrado, continuidadeValida: false }, 3)).toBeUndefined();
    expect(
      transicaoPosse({ ...encerrado, grauMaximo: "incerto", motivoEncerramento: "sem_sinal" }, 3)
    ).toBeUndefined();
  });
});

describe("estadosDeMudancaCena", () => {
  it("expõe o par anterior/posterior apenas quando o estado foi observado", () => {
    expect(estadosDeMudancaCena(mudanca())).toEqual({
      estadoAnterior: "fechada",
      estadoPosterior: "aberta",
    });
    expect(estadosDeMudancaCena(mudanca({ observado: false }))).toEqual({});
    expect(estadosDeMudancaCena(mudanca({ statusEvidencia: "possivel" }))).toEqual({});
    expect(estadosDeMudancaCena(mudanca({ statusEvidencia: "ocluido" }))).toEqual({});
    expect(estadosDeMudancaCena(mudanca({ statusEvidencia: "falha_percepcao" }))).toEqual({});
    expect(estadosDeMudancaCena(mudanca({ tipo: "aparicao" }))).toEqual({});
  });

  it("liga a mudanca ao evento somente pelo mesmo objeto, sessao e janela", () => {
    const evento = {
      sessionId: "s1",
      entidadeId: "obj-1",
      inicioEm: "2026-11-22T10:00:00.000Z",
      fimEm: "2026-11-22T10:00:02.000Z",
    };
    const detectadoEmMs = Date.parse("2026-11-22T10:00:01.000Z");
    expect(
      estadosObservadosParaEvento(evento, [mudanca({ detectadoEmMs })])
    ).toEqual({ estadoAnterior: "fechada", estadoPosterior: "aberta" });
    expect(
      estadosObservadosParaEvento(evento, [mudanca({ detectadoEmMs, objetoId: "outro" })])
    ).toEqual({});
    expect(
      estadosObservadosParaEvento(evento, [mudanca({ detectadoEmMs, sessaoId: "outra" })])
    ).toEqual({});
    expect(
      estadosObservadosParaEvento(evento, [
        mudanca({ detectadoEmMs: detectadoEmMs + 60_000 }),
      ])
    ).toEqual({});
    expect(estadosObservadosParaEvento({ ...evento, entidadeId: undefined }, [mudanca()])).toEqual(
      {}
    );
  });
});
