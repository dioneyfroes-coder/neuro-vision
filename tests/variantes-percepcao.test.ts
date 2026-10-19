import { describe, expect, it } from "vitest";
import {
  VARIANTE_PADRAO,
  VARIANTES_PERCEPCAO,
  obterVariante,
} from "../public/perception/variantes";

describe("variantes de percepcao (Etapa 9)", () => {
  it("define a matriz B/C/D do roteiro", () => {
    expect(VARIANTES_PERCEPCAO.sequencia).toMatchObject({
      id: "sequencia",
      percepcaoLocal: false,
      dadosLocais: false,
      temporal: "ausente",
    });
    expect(VARIANTES_PERCEPCAO.fundida).toMatchObject({
      id: "fundida",
      percepcaoLocal: true,
      dadosLocais: true,
      temporal: "basico",
    });
    expect(VARIANTES_PERCEPCAO.completa).toMatchObject({
      id: "completa",
      percepcaoLocal: true,
      dadosLocais: true,
      temporal: "ampliado",
    });
  });

  it("mantem os tres eixos coerentes (dados locais exigem percepcao local)", () => {
    for (const variante of Object.values(VARIANTES_PERCEPCAO)) {
      if (variante.dadosLocais) expect(variante.percepcaoLocal).toBe(true);
      if (variante.percepcaoLocal) expect(variante.temporal).not.toBe("ausente");
    }
  });

  it("resolve por id, por definicao e cai no padrao quando ausente/desconhecida", () => {
    expect(obterVariante("fundida")).toBe(VARIANTES_PERCEPCAO.fundida);
    expect(obterVariante(VARIANTES_PERCEPCAO.sequencia)).toBe(VARIANTES_PERCEPCAO.sequencia);
    expect(obterVariante(undefined)).toBe(VARIANTE_PADRAO);
    expect(obterVariante("inexistente")).toBe(VARIANTE_PADRAO);
    expect(VARIANTE_PADRAO).toBe(VARIANTES_PERCEPCAO.completa);
  });
});
