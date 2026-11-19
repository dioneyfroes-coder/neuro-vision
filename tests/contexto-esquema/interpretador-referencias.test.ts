import { describe, expect, it } from "vitest";
import { InterpretadorCiclo } from "../../public/interpretation/interpretador-ciclo";
import {
  observacao,
  pacote,
} from "../helpers/contexto-esquema";

describe("InterpretadorCiclo valida referencias do modelo", () => {
  it("remove evidencias inexistentes e as expõe em evidenciasInvalidas", async () => {
    const interpreter = new InterpretadorCiclo({
      enviar: async () => ({
        texto:
          '{"resumo":"x","acoes":[{"descricao":"y","evidencias":["f1","fantasma"]}],' +
          '"evidencias":["f1","inventado"],"incertezas":[],"contradicoes":[]}',
        modelo: "m",
      }),
    });
    const res = await interpreter.interpretar(pacote([observacao({ frameId: "f1" })]));
    expect(res.evidencias).toEqual(["f1"]);
    expect(res.evidenciasInvalidas).toEqual(["inventado"]);
    expect(res.acoes[0].evidencias).toEqual(["f1"]);
    expect(res.acoes[0].evidenciasInvalidas).toEqual(["fantasma"]);
  });

  it("normaliza 'Imagem 1' para o frameId real", async () => {
    const interpreter = new InterpretadorCiclo({
      enviar: async () => ({
        texto:
          '{"resumo":"x","acoes":[],"evidencias":["Imagem 1"],"incertezas":[],"contradicoes":[]}',
        modelo: "m",
      }),
    });
    const res = await interpreter.interpretar(pacote([observacao({ frameId: "f1" })]));
    expect(res.evidencias).toEqual(["f1"]);
  });

  it("repassa a serializacao experimental de maos (21 landmarks + geometria)", async () => {
    let landmarks: number | undefined;
    let completos: boolean | undefined;
    let geometria: number | undefined;
    const interpreter = new InterpretadorCiclo({
      enviar: async (requisicao) => {
        const mao = requisicao.contexto.frames[0].maos[0];
        landmarks = mao.landmarks.length;
        completos = mao.landmarksCompletos;
        geometria = mao.geometria?.dedos.length;
        return {
          texto:
            '{"resumo":"x","acoes":[],"evidencias":[],"incertezas":[],"contradicoes":[]}',
          modelo: "m",
        };
      },
      serializacao: { landmarksCompletos: true },
    });
    await interpreter.interpretar(pacote([observacao({ frameId: "f1" })]));
    expect(landmarks).toBe(21);
    expect(completos).toBe(true);
    expect(geometria).toBe(5);
  });
});