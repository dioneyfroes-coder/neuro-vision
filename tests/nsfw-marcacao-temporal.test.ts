import { describe, expect, it } from "vitest";
import {
  enriquecerMarcacoesTemporais,
  formatarTempoMarcacaoNsfw,
  ordenarMarcacoesTemporais,
} from "../src/domain/nsfw-marcacao-temporal";

const marca = { rotulo: "penis", score: 0.7, caixa: { xmin: 0, ymin: 0, xmax: 10, ymax: 10 } };

describe("tempo por marcação NSFW (Fase 4)", () => {
  it("carimba o frame e deriva ms do ISO sem alterar a marcação original", () => {
    const original = { ...marca };
    const [enriquecida] = enriquecerMarcacoesTemporais([marca], {
      frameId: "f-2",
      indice: 2,
      capturadoEm: "2026-11-22T12:00:00.000Z",
      offsetMs: 1500,
    });

    expect(enriquecida.rotulo).toBe("penis");
    expect(enriquecida.score).toBe(0.7);
    expect(enriquecida.caixa).toEqual(marca.caixa);
    expect(enriquecida.frameId).toBe("f-2");
    expect(enriquecida.indiceFrame).toBe(2);
    expect(enriquecida.capturadoEmMs).toBe(Date.parse("2026-11-22T12:00:00.000Z"));
    expect(enriquecida.offsetMs).toBe(1500);
    expect(enriquecida.tempoConfiavel).toBe(true);
    expect(marca).toEqual(original);
  });

  it("nunca inventa 'agora' quando o tempo falta ou é inválido", () => {
    const [semTempo] = enriquecerMarcacoesTemporais([marca]);
    expect(semTempo.tempoConfiavel).toBe(false);
    expect(semTempo.capturadoEmMs).toBeUndefined();
    expect(formatarTempoMarcacaoNsfw(semTempo)).toBe("tempo_desconhecido");

    const [invalido] = enriquecerMarcacoesTemporais([marca], {
      frameId: "f-1",
      capturadoEm: "nao-e-data",
      capturadoEmMs: Number.NaN,
      offsetMs: Number.POSITIVE_INFINITY,
    });
    expect(invalido.tempoConfiavel).toBe(false);
    expect(formatarTempoMarcacaoNsfw(invalido)).toBe("frame f-1; tempo_desconhecido");
  });

  it("formata tempo real com offset e referência", () => {
    const [enriquecida] = enriquecerMarcacoesTemporais([marca], {
      frameId: "f-3",
      capturadoEm: "2026-11-22T12:00:01.500Z",
      offsetMs: 1500,
    });
    expect(formatarTempoMarcacaoNsfw(enriquecida)).toBe(
      "t=2026-11-22T12:00:01.500Z; offset=1500ms; frame f-3"
    );
  });

  it("ordena cronologicamente e mantém sem tempo no fim sem descartar", () => {
    const comTempo = enriquecerMarcacoesTemporais([marca], { capturadoEmMs: 200 });
    const maisCedo = enriquecerMarcacoesTemporais([marca], { capturadoEmMs: 100 });
    const semTempo = enriquecerMarcacoesTemporais([marca]);
    const ordenadas = ordenarMarcacoesTemporais([semTempo[0], comTempo[0], maisCedo[0]]);
    expect(ordenadas.map((m) => m.capturadoEmMs)).toEqual([100, 200, undefined]);
    expect(ordenadas).toHaveLength(3);
  });
});
