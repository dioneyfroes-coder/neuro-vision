import { vi } from "vitest";
import type { MotorMaos, SaidaMaosCru } from "../../public/perception/adapters/hand-gesture.adapter";
import type { MotorPose, SaidaPoseCru } from "../../public/perception/adapters/pose-estimator.adapter";

export function fakeMotorPose(): MotorPose & { encerrar: ReturnType<typeof vi.fn> } {
  return {
    executar: async (): Promise<SaidaPoseCru> => ({
      pessoas: [{ keypoints: [{ x: 0, y: 0 }], confianca: 0.9 }],
      dimensoes: { largura: 100, altura: 100 },
    }),
    dispositivo: "wasm",
    versao: "teste-1.0",
    encerrar: vi.fn(),
  };
}

export function fakeMotorMaos(): MotorMaos & { encerrar: ReturnType<typeof vi.fn> } {
  return {
    executar: async (): Promise<SaidaMaosCru> => ({
      maos: [
        {
          landmarks: [{ x: 0.1, y: 0.2, z: 0 }],
          lateralidade: "Right",
          gestos: [{ nome: "Thumb_Up", confianca: 0.9 }],
        },
      ],
    }),
    dispositivo: "cpu",
    versao: "mediapipe-0.10.21",
    encerrar: vi.fn(),
  };
}
