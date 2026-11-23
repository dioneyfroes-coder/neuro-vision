import { describe, expect, it } from "vitest";
import { blocoNsfwPrompt } from "../src/nsfw-prompt";
import type { PacoteCiclo } from "../src/domain/cycle";
import type { ObservacaoFrame } from "../src/domain";
import { montarContextoCiclo } from "../public/interpretation/contexto";
import { montarPromptInterpretacao } from "../public/interpretation/prompt";
import { OBS_BASE, PACOTE } from "./helpers/interpretacao-payload";

describe("tempo e proposta de cena no prompt NSFW (Fase 4)", () => {
  it("mantém o texto antigo quando não há tempo nem classificação", () => {
    const bloco = blocoNsfwPrompt([
      {
        indice: 1,
        frameId: "f1",
        marcacoes: [{ rotulo: "penis", score: 0.8, caixa: { xmin: 0, ymin: 0, xmax: 1, ymax: 1 } }],
      },
    ]);
    expect(bloco).toContain("Imagem 1 (frameId f1)");
    expect(bloco).not.toContain("tempo_desconhecido");
    expect(bloco).not.toContain("PROPOSTAS DE CENA");
  });

  it("imprime o tempo real por marcação e a instrução de proposta de cena", () => {
    const bloco = blocoNsfwPrompt([
      {
        indice: 2,
        frameId: "f2",
        marcacoes: [
          {
            rotulo: "make_love",
            score: 0.35,
            caixa: { xmin: 0, ymin: 0, xmax: 1, ymax: 1 },
            tipoClasse: "acao",
            escopoClasse: "cena",
            usoPermitido: "proposta_temporal",
            capturadoEm: "2026-10-17T12:00:01.000Z",
            offsetMs: 1000,
            tempoConfiavel: true,
          },
        ],
      },
    ]);

    expect(bloco).toContain("PROPOSTAS DE CENA");
    expect(bloco).toContain("proposta_de_cena_nao_confirmacao");
    expect(bloco).toContain("t=2026-10-17T12:00:01.000Z");
    expect(bloco).toContain("offset=1000ms");
    expect(bloco).toContain("frame f2");
  });

  it("o prompt multimodal herda o carimbo do frame quando a marcação não traz tempo", () => {
    const obs: ObservacaoFrame = {
      ...OBS_BASE,
      frameId: "f1",
      capturadoEmMs: 0,
      imagem: "img1",
      nsfw: {
        marcacoes: [
          {
            rotulo: "make_love",
            score: 0.35,
            caixa: { xmin: 0, ymin: 0, xmax: 1, ymax: 1 },
          },
        ],
      },
    };
    const pacote: PacoteCiclo = { ...PACOTE, observacoes: [obs] };
    const { contexto } = montarContextoCiclo(pacote);
    const prompt = montarPromptInterpretacao(contexto);

    expect(prompt).toContain("t=2026-10-17T12:00:00.000Z");
    expect(prompt).toContain("proposta_de_cena_nao_confirmacao");
    expect(prompt).toContain("PROPOSTAS DE CENA");
  });
});
