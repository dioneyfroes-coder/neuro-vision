import { describe, expect, it } from "vitest";
import {
  resumirEvidenciaTemporalNsfw,
  sinalNsfwDoFrame,
} from "../src/domain/nsfw-evidencia-temporal";
import { classificarMarcacoesNsfw } from "../src/domain/nsfw-classificacao-rotulo";
import { enriquecerMarcacoesTemporais } from "../src/domain/nsfw-marcacao-temporal";

function preparar(
  marcacoes: Array<{ rotulo: string; frameId: string; score?: number; modelos?: string[] }>
) {
  const temporais = marcacoes.map((m, i) => {
    const [enriquecida] = enriquecerMarcacoesTemporais([m], {
      frameId: m.frameId,
      capturadoEmMs: i * 100,
    });
    return enriquecida;
  });
  return classificarMarcacoesNsfw(temporais).map(({ rotulo, classificacao, marcacao }) => ({
    ...marcacao,
    rotulo,
    classificacao,
  }));
}

describe("evidência temporal NSFW (Fase 4)", () => {
  it("agrupa por frame e separa proposta de ação de anatomia", () => {
    const resumo = resumirEvidenciaTemporalNsfw(
      preparar([
        { rotulo: "make_love", frameId: "f-1", modelos: ["a", "b"] },
        { rotulo: "penis", frameId: "f-1" },
        { rotulo: "make_love", frameId: "f-2" },
      ])
    );

    expect(resumo.frames).toHaveLength(2);
    expect(resumo.frames[0].frameId).toBe("f-1");
    expect(resumo.frames[0].acoes).toEqual(["make_love"]);
    expect(resumo.frames[0].anatomias).toEqual(["penis"]);
    expect(resumo.frames[0].concordancias).toBe(1);
    expect(resumo.frames[0].sinal).toBe(3);
    expect(resumo.frames[0].motivos).toEqual([
      "nsfw_proposta_acao",
      "nsfw_concordancia_modelos",
    ]);
    expect(resumo.framesComProposta).toEqual(["f-1", "f-2"]);
    expect(resumo.temPropostaCena).toBe(true);
    expect(resumo.tempoIncompleto).toBe(false);
  });

  it("mantém o sinal fraco e limitado a 5 — detector não é evento validado", () => {
    const resumo = resumirEvidenciaTemporalNsfw(
      preparar(
        Array.from({ length: 8 }, (_, i) => ({
          rotulo: "make_love",
          frameId: "f-1",
          modelos: ["a", "b"],
          score: i / 10,
        }))
      )
    );
    expect(resumo.frames[0].sinal).toBe(5);
    expect(sinalNsfwDoFrame(resumo, "f-1").sinal).toBe(5);
    expect(sinalNsfwDoFrame(resumo, "f-inexistente")).toEqual({ sinal: 0, motivos: [] });
  });

  it("marca tempo desconhecido e é determinístico quanto à ordem", () => {
    const semTempo = [{ rotulo: "penis", score: 0.5, caixa: { xmin: 0, ymin: 0, xmax: 1, ymax: 1 } }];
    const [marcacao] = enriquecerMarcacoesTemporais(semTempo, { frameId: "f-1" });
    const resumo = resumirEvidenciaTemporalNsfw([marcacao]);
    expect(resumo.tempoIncompleto).toBe(true);
    expect(resumo.frames[0].motivos).toContain("nsfw_tempo_desconhecido");

    const itens = preparar([
      { rotulo: "penis", frameId: "f-2" },
      { rotulo: "vagina", frameId: "f-1" },
    ]);
    expect(resumirEvidenciaTemporalNsfw([...itens].reverse())).toEqual(
      resumirEvidenciaTemporalNsfw(itens)
    );
  });
});
