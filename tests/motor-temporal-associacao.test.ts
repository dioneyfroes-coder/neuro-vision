import { describe, expect, it } from "vitest";
import { estaIndisponivel } from "../src/domain";
import type { ObservacaoFrame, PessoaPose, PontoCorporal } from "../src/domain";
import { MotorTemporalImpl } from "../public/temporal/motor-temporal";
import { obs, reiniciarContador } from "./helpers/motor-temporal";

// Motor: associacao mao <-> pessoa por punho e lateralidade
// ---------------------------------------------------------------------------

describe("MotorTemporalImpl — associacao mao <-> pessoa", () => {
  /** Pose COCO com o torso em `xTorso` e punhos esquerdo/direito nas posicoes dadas. */
  function poseComPunhos(
    xTorso: number,
    punhoEsquerdoX: number,
    punhoDireitoX: number
  ): PessoaPose {
    const pontos: PontoCorporal[] = Array.from({ length: 17 }, () => ({
      x: xTorso,
      y: 0.5,
      confianca: 0.9,
    }));
    pontos[9] = { x: punhoEsquerdoX, y: 0.5, confianca: 0.9 };
    pontos[10] = { x: punhoDireitoX, y: 0.5, confianca: 0.9 };
    return { pontos, confianca: 0.9 };
  }

  function maoComPunho(
    lateralidade: "esquerda" | "direita" | "desconhecida",
    x: number
  ): NonNullable<ObservacaoFrame["maos"]>["maos"][number] {
    return {
      lateralidade,
      landmarks: [
        { x, y: 0.5 }, // punho (landmark 0)
        { x: x + 0.02, y: 0.48 },
        { x: x + 0.04, y: 0.46 },
      ],
    };
  }

  function idDaPessoaPeloPunho(
    observacao: ObservacaoFrame,
    punho: 9 | 10,
    x: number
  ): string | undefined {
    if (estaIndisponivel(observacao.pose)) return undefined;
    return observacao.pose.pessoas.find((pessoa) => pessoa.pontos[punho]?.x === x)?.entidadeId;
  }

  function pessoaDaMao(observacao: ObservacaoFrame): string | undefined {
    if (estaIndisponivel(observacao.maos)) return undefined;
    return observacao.maos.maos[0]?.pessoaEntidadeId;
  }

  it("prefere o punho de mesma lateralidade ao escolher a pessoa", () => {
    reiniciarContador();
    const motor = new MotorTemporalImpl({
      rastreador: { distanciaMaxima: 0.3, maxFramesAusente: 3, alphaSuavizacao: 0.5 },
      distanciaMaximaMaoPessoa: 0.3,
    });
    const resultado = motor.processar([
      obs({
        ms: 0,
        pose: {
          pessoas: [
            // A: punho esquerdo em 0.3.
            poseComPunhos(0.3, 0.3, 0.9),
            // B: punho esquerdo em 0.9 e direito em 0.45. Sem a preferencia de
            // lateralidade, o punho direito de B (0.45) venceria por distancia.
            poseComPunhos(0.7, 0.9, 0.45),
          ],
        },
        maos: { maos: [maoComPunho("esquerda", 0.5)] },
      }),
    ]);

    const idA = idDaPessoaPeloPunho(resultado.observacoes[0], 9, 0.3);
    const idB = idDaPessoaPeloPunho(resultado.observacoes[0], 9, 0.9);
    expect(idA).toBeDefined();
    expect(idB).toBeDefined();
    expect(idA).not.toBe(idB);
    expect(pessoaDaMao(resultado.observacoes[0])).toBe(idA);
  });

  it("usa a unica pessoa ativa como fallback mesmo fora do raio", () => {
    reiniciarContador();
    const motor = new MotorTemporalImpl({
      rastreador: { distanciaMaxima: 0.3, maxFramesAusente: 3, alphaSuavizacao: 0.5 },
      distanciaMaximaMaoPessoa: 0.2,
    });
    const resultado = motor.processar([
      obs({
        ms: 0,
        pose: { pessoas: [poseComPunhos(0.9, 0.9, 0.9)] },
        maos: { maos: [maoComPunho("esquerda", 0.1)] },
      }),
    ]);

    const id = idDaPessoaPeloPunho(resultado.observacoes[0], 9, 0.9);
    expect(id).toBeDefined();
    expect(pessoaDaMao(resultado.observacoes[0])).toBe(id);
  });

  it("nao inventa associacao ambigua entre duas pessoas", () => {
    reiniciarContador();
    const motor = new MotorTemporalImpl({
      rastreador: { distanciaMaxima: 0.3, maxFramesAusente: 3, alphaSuavizacao: 0.5 },
      distanciaMaximaMaoPessoa: 0.2,
    });
    const resultado = motor.processar([
      obs({
        ms: 0,
        pose: {
          pessoas: [poseComPunhos(0.2, 0.2, 0.2), poseComPunhos(0.8, 0.8, 0.8)],
        },
        maos: { maos: [maoComPunho("esquerda", 0.5)] },
      }),
    ]);

    // A mao esta a 0.3 de ambos os punhos; mais de uma pessoa ativa e fora do
    // raio: a resposta correta e nao atribuir, em vez de escolher no chute.
    expect(pessoaDaMao(resultado.observacoes[0])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Maquina de sinais: confirmacao e encerramento temporais
