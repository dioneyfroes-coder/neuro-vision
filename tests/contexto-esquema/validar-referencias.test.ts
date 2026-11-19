import { describe, expect, it } from "vitest";
import { montarContextoCiclo } from "../../public/interpretation/contexto";
import {
  idsReais,
  validarReferencias,
} from "../../public/interpretation/esquema";
import {
  observacao,
  pacote,
} from "../helpers/contexto-esquema";

describe("validarReferencias", () => {
  const contexto = montarContextoCiclo(
    pacote([observacao({ frameId: "f1" })], [
      {
        eventoId: "e1",
        sessionId: "s1",
        tipo: "aparicao",
        inicioEm: "2026-10-17T12:00:00.000Z",
        descricao: "Aparicao",
        origens: ["objetos"],
        frameIds: ["f1"],
        estado: "confirmado",
      },
    ])
  ).contexto;

  it("aceita frameIds/eventoIds reais e resolve indice numerico", () => {
    const { validas, invalidas } = validarReferencias(contexto, ["f1", "e1", "Imagem 1", "1"]);
    expect(validas).toEqual(["f1", "e1"]);
    expect(invalidas).toEqual([]);
  });

  it("rejeita referencias inexistentes sem fundir com as validas", () => {
    const { validas, invalidas } = validarReferencias(contexto, ["f1", "f99", "evento-x"]);
    expect(validas).toEqual(["f1"]);
    expect(invalidas).toEqual(["f99", "evento-x"]);
  });

  it("idsReais reune frames, eventos e frames de evidencia dos eventos", () => {
    expect(idsReais(contexto)).toEqual(new Set(["f1", "e1"]));
    const comEvidenciaForaDaAmostra = montarContextoCiclo(
      pacote([observacao({ frameId: "f1" })], [
        {
          eventoId: "e2",
          sessionId: "s1",
          tipo: "gesto_detectado",
          inicioEm: "2026-10-17T12:00:00.000Z",
          descricao: "Gesto",
          origens: ["maos"],
          frameIds: ["f-fora-da-amostra"],
          estado: "confirmado",
        },
      ])
    ).contexto;
    expect(validarReferencias(comEvidenciaForaDaAmostra, ["f-fora-da-amostra"]).validas).toEqual([
      "f-fora-da-amostra",
    ]);
  });
});