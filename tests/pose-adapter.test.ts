import { describe, expect, it, vi } from "vitest";
import {
  AdaptadorPose,
  normalizarPoses,
} from "../public/perception/adapters/pose-estimator.adapter";
import type { MotorPose, SaidaPoseCru } from "../public/perception/adapters/pose-estimator.adapter";
import { estaIndisponivel } from "../src/domain";

function saida(parcial: Partial<SaidaPoseCru> = {}): SaidaPoseCru {
  return {
    pessoas: [
      {
        keypoints: [
          { x: 320, y: 240, confianca: 0.9 },
          { x: 640, y: 480, confianca: 0.8 },
        ],
        confianca: 0.85,
      },
    ],
    dimensoes: { largura: 640, altura: 480 },
    ...parcial,
  };
}

describe("normalizarPoses", () => {
  it("converte keypoints em pixels para [0, 1] e preserva confianca", () => {
    const resultado = normalizarPoses(saida());
    expect(resultado.pessoas).toHaveLength(1);
    expect(resultado.pessoas[0].pontos).toEqual([
      { x: 0.5, y: 0.5, confianca: 0.9 },
      { x: 1, y: 1, confianca: 0.8 },
    ]);
    expect(resultado.pessoas[0].confianca).toBe(0.85);
  });

  it("limita coordenadas e confianca ao intervalo [0, 1]", () => {
    const resultado = normalizarPoses(
      saida({
        pessoas: [
          {
            keypoints: [
              { x: -50, y: 900, confianca: 1.4 },
              { x: Number.NaN, y: 10, confianca: -0.2 },
            ],
          },
        ],
      })
    );
    expect(resultado.pessoas[0].pontos[0]).toEqual({ x: 0, y: 1, confianca: 1 });
    expect(resultado.pessoas[0].pontos[1]).toEqual({ x: 0, y: 0.020833333333333332, confianca: 0 });
  });

  it("nao divide por zero quando as dimensoes sao invalidas", () => {
    const resultado = normalizarPoses(saida({ dimensoes: { largura: 0, altura: 0 } }));
    expect(resultado.pessoas[0].pontos[0].x).toBe(1);
    expect(resultado.pessoas[0].pontos[0].y).toBe(1);
  });
});

describe("AdaptadorPose", () => {
  function motorFalso(saidaCrua: SaidaPoseCru): MotorPose {
    return { executar: () => Promise.resolve(saidaCrua) };
  }

  it("carrega o motor, mede a carga e devolve a pose normalizada", async () => {
    const criarMotor = vi.fn(() => Promise.resolve(motorFalso(saida())));
    const adaptador = new AdaptadorPose(criarMotor);

    await adaptador.carregar("Xenova/yolov8n-pose", () => {});
    expect(criarMotor).toHaveBeenCalledWith("Xenova/yolov8n-pose", expect.any(Function));
    expect(adaptador.modelo).toBe("Xenova/yolov8n-pose");
    expect(adaptador.metricas.tempoCargaMs).toBeTypeOf("number");

    const resultado = await adaptador.estimar({ imagem: "x" });
    expect(estaIndisponivel(resultado)).toBe(false);
    if (estaIndisponivel(resultado)) throw new Error("nao esperado");
    expect(resultado.pessoas[0].pontos[0]).toEqual({ x: 0.5, y: 0.5, confianca: 0.9 });
    expect(adaptador.metricas.tempoInferenciaMs).toBeTypeOf("number");
  });

  it("devolve indisponivel quando o motor ainda nao foi carregado", async () => {
    const adaptador = new AdaptadorPose(() => Promise.resolve(motorFalso(saida())));
    const resultado = await adaptador.estimar({ imagem: "x" });
    expect(resultado).toMatchObject({ indisponivel: true, subsistema: "pose" });
  });

  it("converte falha de inferencia em indisponivel, nunca em lista vazia", async () => {
    const adaptador = new AdaptadorPose(() =>
      Promise.resolve({ executar: () => Promise.reject(new Error("modelo falhou")) })
    );
    await adaptador.carregar("m", () => {});
    const resultado = await adaptador.estimar({ imagem: "x" });
    expect(resultado).toEqual({ indisponivel: true, subsistema: "pose", motivo: "modelo falhou" });
    expect(adaptador.metricas.tempoInferenciaMs).toBeTypeOf("number");
  });
});
