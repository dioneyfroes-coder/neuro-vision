import { describe, expect, it } from "vitest";
import type { ObservacaoFrame, PessoaPose, PontoCorporal } from "../src/domain";
import { MotorTemporalImpl } from "../public/temporal/motor-temporal";
import { obs, reiniciarContador } from "./helpers/motor-temporal";

describe("MotorTemporalImpl — rastreamento de pessoas", () => {
  it("mudanca brusca de postura nao troca o ID (referencia no torso)", () => {
    reiniciarContador();
    const motor = new MotorTemporalImpl({
      // Limiar curto: se a referencia fosse o centroide de todos os keypoints,
      // os membros em posicoes opostas mudariam o centro e criariam outro track.
      rastreador: { distanciaMaxima: 0.05, maxFramesAusente: 5, alphaSuavizacao: 0.6 },
    });
    const poseComMembros = (yMembros: number): ObservacaoFrame["pose"] => {
      const pontos: PontoCorporal[] = Array.from({ length: 17 }, () => ({
        x: 0.5,
        y: yMembros,
        confianca: 0.9,
      }));
      // Torso fixo: ombros (5/6) e quadris (11/12).
      pontos[5] = { x: 0.45, y: 0.4, confianca: 0.9 };
      pontos[6] = { x: 0.55, y: 0.4, confianca: 0.9 };
      pontos[11] = { x: 0.45, y: 0.6, confianca: 0.9 };
      pontos[12] = { x: 0.55, y: 0.6, confianca: 0.9 };
      return { pessoas: [{ pontos, confianca: 0.9 } as PessoaPose] };
    };

    motor.processar([obs({ ms: 0, pose: poseComMembros(0.15) })]);
    const id = motor.pessoasVivas[0]?.entidadeId;
    expect(id).toBeDefined();

    // Bracos, cabeca e pernas saltam entre extremos; o torso nao se move.
    for (let i = 0; i < 4; i += 1) {
      motor.processar([
        obs({ ms: (i + 1) * 100, pose: poseComMembros(i % 2 === 0 ? 0.85 : 0.15) }),
      ]);
      expect(motor.pessoasVivas).toHaveLength(1);
      expect(motor.pessoasVivas[0].entidadeId).toBe(id);
    }
  });
});
