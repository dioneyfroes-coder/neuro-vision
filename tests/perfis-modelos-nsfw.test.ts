import { describe, expect, it } from "vitest";
import {
  MODELOS_NSFW_CONJUNTO,
  MODELOS_POR_PERFIL_NSFW,
  MODELO_NSFW_PADRAO,
  modelosDoPerfilNsfw,
  normalizarPerfilModelosNsfw,
} from "../public/nsfw-onnx";

describe("perfis de execucao NSFW (Fase 3)", () => {
  it("define exatamente os tres perfis do plano", () => {
    expect(MODELOS_POR_PERFIL_NSFW.leve).toEqual([MODELO_NSFW_PADRAO]);
    expect(MODELOS_POR_PERFIL_NSFW.equilibrado).toEqual([
      MODELO_NSFW_PADRAO,
      "erax_nsfw_yolo11n",
    ]);
    expect(MODELOS_POR_PERFIL_NSFW.completo).toEqual(MODELOS_NSFW_CONJUNTO);
    expect(MODELOS_POR_PERFIL_NSFW.completo).toHaveLength(6);
  });

  it("normaliza opt-in e preserva o completo como default", () => {
    expect(normalizarPerfilModelosNsfw("leve")).toBe("leve");
    expect(normalizarPerfilModelosNsfw("equilibrado")).toBe("equilibrado");
    expect(normalizarPerfilModelosNsfw("completo")).toBe("completo");
    expect(normalizarPerfilModelosNsfw("LEVE")).toBeUndefined();
    expect(normalizarPerfilModelosNsfw(null)).toBeUndefined();
    expect(modelosDoPerfilNsfw()).toEqual(MODELOS_NSFW_CONJUNTO);
  });
});
