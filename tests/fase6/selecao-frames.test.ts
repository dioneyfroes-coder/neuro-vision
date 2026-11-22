import { describe, expect, it } from "vitest";
import {
  selecionarFramesRelevantes,
  type FrameParaSelecao,
} from "../../src/domain/selecao-frames";

function frame(id: string, capturadoEmMs: number, extra: Partial<FrameParaSelecao> = {}): FrameParaSelecao {
  return { frameId: id, capturadoEmMs, ...extra };
}

describe("seleção automática de frames (Fase 6, item 2)", () => {
  it("cai para amostragem uniforme quando não há sinal de relevância", () => {
    const frames = Array.from({ length: 6 }, (_, i) => frame(`f${i}`, i * 100));
    const selecao = selecionarFramesRelevantes(frames, 3);
    expect(selecao.criterio).toBe("uniforme");
    expect(selecao.selecionados).toEqual(["f0", "f3", "f5"]);
    expect(Object.values(selecao.motivos)).toEqual(["amostragem_uniforme", "amostragem_uniforme", "amostragem_uniforme"]);
  });

  it("preserva primeiro e último e prioriza frame com evento sustentado", () => {
    const frames = [
      frame("f0", 0),
      frame("f1", 100, { eventosSuportados: ["ev1"], sinaisAtividade: 1 }),
      frame("f2", 200),
      frame("f3", 300),
      frame("f4", 400),
    ];
    const selecao = selecionarFramesRelevantes(frames, 3, ["ev1"]);
    expect(selecao.criterio).toBe("relevancia");
    expect(selecao.selecionados).toEqual(["f0", "f1", "f4"]);
    expect(selecao.motivos.f1).toContain("evento_relevante:ev1");
  });

  it("mantém falha de percepção como sinal, nunca como ausência", () => {
    const frames = [
      frame("f0", 0),
      frame("f1", 100, { falhaPercepcao: true }),
      frame("f2", 200),
      frame("f3", 300),
      frame("f4", 400),
    ];
    const selecao = selecionarFramesRelevantes(frames, 3);
    expect(selecao.selecionados).toContain("f1");
    expect(selecao.motivos.f1).toBe("falha_percepcao_sinalizada");
  });

  it("respeita limites e ordena a saída cronologicamente", () => {
    const frames = [
      frame("f4", 400, { eventosSuportados: ["ev1"] }),
      frame("f0", 0),
      frame("f2", 200, { percepcaoValida: false }),
      frame("f3", 300),
      frame("f1", 100),
    ];
    const selecao = selecionarFramesRelevantes(frames, 4, ["ev1"]);
    expect(selecao.selecionados).toEqual(["f0", "f1", "f2", "f4"]);
    expect(selecao.totalFrames).toBe(5);
  });
});
