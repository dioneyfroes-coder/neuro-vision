import { describe, expect, it } from "vitest";
import {
  CLASSES_NSFW_IGNORADAS,
  LIMIARES_NSFW,
  filtrarClassesNsfwRelevantes,
  filtrarDeteccoesNsfw,
  limiarEfetivoNsfw,
} from "../public/nsfw-onnx";
import type { DeteccaoYOLO } from "../public/yolo-onnx";

const deteccao = (label: string, score: number): DeteccaoYOLO => ({
  label,
  score,
  box: { xmin: 0, ymin: 0, xmax: 1, ymax: 1 },
});

describe("avaliacao deterministica dos filtros corporais (Fase 2)", () => {
  it("MALE_BREAST_EXPOSED usa o mesmo piso de 0,50 de FEMALE_BREAST_EXPOSED", () => {
    expect(LIMIARES_NSFW.MALE_BREAST_EXPOSED).toBe(0.5);
    expect(limiarEfetivoNsfw("MALE_BREAST_EXPOSED")).toBe(0.5);
    expect(limiarEfetivoNsfw("FEMALE_BREAST_EXPOSED")).toBe(0.5);

    const filtradas = filtrarDeteccoesNsfw([
      deteccao("MALE_BREAST_EXPOSED", 0.49),
      deteccao("MALE_BREAST_EXPOSED", 0.5),
      deteccao("FEMALE_BREAST_EXPOSED", 0.49),
      deteccao("FEMALE_BREAST_EXPOSED", 0.5),
    ]);
    expect(filtradas.map((d) => d.label)).toEqual([
      "MALE_BREAST_EXPOSED",
      "FEMALE_BREAST_EXPOSED",
    ]);
  });

  it("BELLY_EXPOSED e BELLY_COVERED sao descartados mesmo com score maximo", () => {
    expect(CLASSES_NSFW_IGNORADAS.has("BELLY_EXPOSED")).toBe(true);
    expect(CLASSES_NSFW_IGNORADAS.has("BELLY_COVERED")).toBe(true);
    expect(LIMIARES_NSFW.BELLY_EXPOSED).toBeUndefined();
    expect(limiarEfetivoNsfw("BELLY_EXPOSED")).toBe(0.5);

    const relevantes = filtrarClassesNsfwRelevantes([
      deteccao("BELLY_EXPOSED", 1),
      deteccao("BELLY_COVERED", 0.99),
      deteccao("MALE_BREAST_EXPOSED", 0.62),
      deteccao("classe_customizada", 0.4),
    ]);
    expect(relevantes.map((d) => d.label)).toEqual([
      "MALE_BREAST_EXPOSED",
      "classe_customizada",
    ]);
  });

  it("o filtro de relevancia remove rosto, pes e axilas sem tocar genitalia", () => {
    const rotulos = ["FACE_MALE", "FEET_EXPOSED", "ARMPITS_COVERED", "MALE_GENITALIA_EXPOSED"];
    expect(filtrarClassesNsfwRelevantes(rotulos.map((r) => deteccao(r, 0.9))).map((d) => d.label)).toEqual(
      ["MALE_GENITALIA_EXPOSED"]
    );
  });
});
