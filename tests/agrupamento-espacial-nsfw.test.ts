import { describe, expect, it } from "vitest";
import {
  associarCaixasNsfw,
  contencaoCaixasNsfw,
  criarGruposEspaciaisNsfw,
  distanciaCentrosNormalizadaNsfw,
  iosCaixasNsfw,
  iouCaixasNsfw,
} from "../src/domain/agrupamento-espacial-nsfw";
import type { MarcacaoNsfw } from "../src/domain";

function marcacao(
  rotulo: string,
  score: number,
  modelo: string,
  caixa: [number, number, number, number]
): MarcacaoNsfw {
  const [xmin, ymin, xmax, ymax] = caixa;
  return { rotulo, score, modelo, modelos: [modelo], caixa: { xmin, ymin, xmax, ymax } };
}

describe("agrupamento espacial NSFW (Fase 3)", () => {
  it("agrupa concordancia e preserva caixas/modelos originais", () => {
    const agrupamento = criarGruposEspaciaisNsfw([
      marcacao("penis", 0.8, "nudenet_320n", [10, 10, 110, 110]),
      marcacao("penis", 0.6, "penis_yolov8m", [12, 12, 108, 108]),
    ]);

    expect(agrupamento.grupos).toHaveLength(1);
    const grupo = agrupamento.grupos[0];
    expect(grupo.status).toBe("concordancia");
    expect(grupo.regiaoId).toBe("r-1");
    expect(grupo.modelos).toEqual(["nudenet_320n", "penis_yolov8m"]);
    expect(grupo.scoreMaximo).toBe(0.8);
    expect(grupo.caixaConsolidada).toEqual({ xmin: 10, ymin: 10, xmax: 110, ymax: 110 });
    expect(grupo.hipoteses.map((h) => h.score)).toEqual([0.8, 0.6]);
    expect(grupo.hipoteses[1].caixaOriginal).toEqual({ xmin: 12, ymin: 12, xmax: 108, ymax: 108 });
  });

  it("registra conflito semantico sem eleger um rotulo correto", () => {
    const agrupamento = criarGruposEspaciaisNsfw([
      marcacao("MALE_GENITALIA_EXPOSED", 0.61, "nudenet_320n", [10, 10, 100, 100]),
      marcacao("penis", 0.54, "penis_yolov8m", [12, 12, 98, 98]),
    ]);

    expect(agrupamento.totalGruposConflitantes).toBe(1);
    expect(agrupamento.grupos[0].status).toBe("conflito_semantico");
    expect(agrupamento.grupos[0].hipoteses.map((h) => h.rotulo)).toEqual([
      "MALE_GENITALIA_EXPOSED",
      "penis",
    ]);
    expect(agrupamento.grupos[0].modelos).toEqual(["nudenet_320n", "penis_yolov8m"]);
  });

  it("mantem regioes distintas separadas mesmo com o mesmo rotulo", () => {
    const agrupamento = criarGruposEspaciaisNsfw([
      marcacao("penis", 0.7, "a", [0, 0, 40, 40]),
      marcacao("penis", 0.5, "b", [160, 160, 200, 200]),
    ]);
    expect(agrupamento.grupos).toHaveLength(2);
    expect(agrupamento.grupos.map((g) => g.regiaoId)).toEqual(["r-1", "r-2"]);
    expect(agrupamento.grupos.every((g) => g.status === "concordancia")).toBe(true);
  });

  it("respeita a fronteira de IoU e expoe as metricas alternativas", () => {
    const a = { xmin: 0, ymin: 0, xmax: 100, ymax: 100 };
    const b = { xmin: 40, ymin: 0, xmax: 140, ymax: 100 };
    expect(iouCaixasNsfw(a, b)).toBeCloseTo(6000 / 14000, 5);
    expect(associarCaixasNsfw(a, b, "iou", 0.6)).toBe(false);
    expect(associarCaixasNsfw(a, b, "iou", 0.4)).toBe(true);

    const pequena = { xmin: 30, ymin: 30, xmax: 70, ymax: 70 };
    const grande = { xmin: 0, ymin: 0, xmax: 100, ymax: 100 };
    expect(iosCaixasNsfw(pequena, grande)).toBeCloseTo(1, 5);
    expect(contencaoCaixasNsfw(pequena, grande)).toBe(1);
    expect(associarCaixasNsfw(pequena, grande, "contencao", 1)).toBe(true);
    expect(distanciaCentrosNormalizadaNsfw(pequena, grande)).toBe(0);
    expect(associarCaixasNsfw(pequena, grande, "centros", 0.5)).toBe(true);
  });

  it("e determinista independentemente da ordem de entrada e nao inventa grupos vazios", () => {
    const marcas = [
      marcacao("penis", 0.7, "a", [0, 0, 50, 50]),
      marcacao("vagina", 0.6, "b", [2, 2, 48, 48]),
      marcacao("penis", 0.5, "c", [200, 200, 250, 250]),
    ];
    const direto = criarGruposEspaciaisNsfw(marcas);
    const invertido = criarGruposEspaciaisNsfw([...marcas].reverse());
    expect(invertido).toEqual(direto);

    const vazio = criarGruposEspaciaisNsfw([]);
    expect(vazio.grupos).toEqual([]);
    expect(vazio.totalGruposConflitantes).toBe(0);
    expect(vazio.criterio).toBe("iou");
    expect(vazio.limiar).toBe(0.6);
  });
});
