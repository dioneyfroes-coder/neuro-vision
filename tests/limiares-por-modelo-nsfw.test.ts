import { describe, expect, it } from "vitest";
import {
  CLASSES_NUDENET,
  LIMIARES_NSFW,
  LIMIARES_NSFW_POR_MODELO,
  criarResolutorLimiarNsfw,
  filtrarDeteccoesNsfw,
  interpretarSaidaNudeNetCru,
  resolverLimiarNsfw,
} from "../public/nsfw-onnx";
import { AdaptadorClassificadorNsfw } from "../public/perception/adapters/nsfw-classifier/adapter-unitario";
import type { DeteccaoYOLO, MotorDeteccao } from "../public/yolo-onnx";

const override = {
  nudenet_320n: { MALE_BREAST_EXPOSED: 0.25 },
};

describe("limiares por modelo e classe (Fase 3)", () => {
  it("aplica precedencia modelo/classe > classe > global", () => {
    expect(LIMIARES_NSFW_POR_MODELO).toEqual({});
    expect(resolverLimiarNsfw("MALE_BREAST_EXPOSED", { global: 0.5 })).toBe(0.5);
    expect(
      resolverLimiarNsfw("MALE_BREAST_EXPOSED", {
        global: 0.5,
        modelo: "nudenet_320n",
        limiaresPorModelo: override,
      })
    ).toBe(0.25);
    expect(
      resolverLimiarNsfw("classe_sem_tabela", { global: 0.42, modelo: "x", limiaresPorModelo: override })
    ).toBe(0.42);
  });

  it("ignora valores invalidos em vez de transforma-los em zero", () => {
    expect(resolverLimiarNsfw("x", { global: -1 })).toBe(0.5);
    expect(resolverLimiarNsfw("x", { global: Number.NaN })).toBe(0.5);
    expect(
      resolverLimiarNsfw("x", {
        global: 0.4,
        limiares: { x: Number.POSITIVE_INFINITY },
      })
    ).toBe(0.4);
  });

  it("o resolvedor alcanca filtro e decodificacao da saida crua", () => {
    const deteccao: DeteccaoYOLO = {
      label: "MALE_BREAST_EXPOSED",
      score: 0.3,
      box: { xmin: 0, ymin: 0, xmax: 10, ymax: 10 },
    };
    const resolver = criarResolutorLimiarNsfw("nudenet_320n", {
      global: 0.5,
      limiaresPorModelo: override,
    });
    expect(filtrarDeteccoesNsfw([deteccao], 0.5)).toEqual([]);
    expect(filtrarDeteccoesNsfw([deteccao], 0.5, LIMIARES_NSFW, resolver)).toEqual([deteccao]);

    const classe = CLASSES_NUDENET.indexOf("MALE_BREAST_EXPOSED");
    const cru = new Float32Array(22);
    cru[0] = 160;
    cru[1] = 160;
    cru[2] = 40;
    cru[3] = 40;
    cru[4 + classe] = 0.3;
    const args = [cru, [1, 1, 22], 0.5, 320, 320, 320] as const;
    expect(interpretarSaidaNudeNetCru(...args)).toEqual([]);
    expect(
      interpretarSaidaNudeNetCru(...args, CLASSES_NUDENET, LIMIARES_NSFW, resolver)
    ).toHaveLength(1);
  });

  it("registra o limiar usado sem alterar o score bruto na marcacao", async () => {
    const motor: MotorDeteccao = {
      modelo: "nudenet_320n",
      dispositivo: "wasm",
      tempoCargaMs: 1,
      async carregar() {},
      async executar(): Promise<DeteccaoYOLO[]> {
        return [
          {
            label: "MALE_BREAST_EXPOSED",
            score: 0.3,
            box: { xmin: 0, ymin: 0, xmax: 10, ymax: 10 },
          },
        ];
      },
      encerrar() {},
    };
    const adaptador = new AdaptadorClassificadorNsfw(motor);
    const resultado = await adaptador.avaliar({ imagem: "data:image/png;base64,AAAA" });

    expect(resultado.marcacoes[0].score).toBe(0.3);
    expect(resultado.marcacoes[0].limiarUsado).toBe(LIMIARES_NSFW.MALE_BREAST_EXPOSED);
  });
});
