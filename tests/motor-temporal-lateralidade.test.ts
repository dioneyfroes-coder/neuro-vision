import { describe, expect, it } from "vitest";
import { estaIndisponivel } from "../src/domain";
import type { ObservacaoFrame } from "../src/domain";
import { criarMotor, obs, reiniciarContador } from "./helpers/motor-temporal";

// Motor: lateralidade como restricao de associacao
// ---------------------------------------------------------------------------

describe("MotorTemporalImpl — lateralidade", () => {
  const mao = (
    lateralidade: "esquerda" | "direita" | "desconhecida",
    x: number
  ): NonNullable<ObservacaoFrame["maos"]>["maos"][number] => ({
    lateralidade,
    landmarks: [
      { x, y: 0.5 },
      { x: x + 0.02, y: 0.48 },
    ],
  });

  const idsPorLateralidade = (
    observacao: ObservacaoFrame
  ): Map<string, string | undefined> => {
    const ids = new Map<string, string | undefined>();
    if (estaIndisponivel(observacao.maos)) return ids;
    for (const detectada of observacao.maos.maos) {
      ids.set(detectada.lateralidade, detectada.entidadeId);
    }
    return ids;
  };

  it("cruzamento de maos nao troca IDs entre esquerda e direita", () => {
    reiniciarContador();
    const motor = criarMotor();
    const r1 = motor.processar([
      obs({
        ms: 0,
        maos: { maos: [mao("esquerda", 0.4), mao("direita", 0.6)] },
      }),
    ]);
    const ids1 = idsPorLateralidade(r1.observacoes[0]);
    const idEsquerda = ids1.get("esquerda");
    const idDireita = ids1.get("direita");
    expect(idEsquerda).toBeDefined();
    expect(idDireita).toBeDefined();
    expect(idEsquerda).not.toBe(idDireita);

    // As trajetorias se cruzam: sem a restricao de lateralidade, o guloso
    // associaria cada mao ao probe mais proximo e trocaria os IDs.
    const r2 = motor.processar([
      obs({
        ms: 100,
        maos: { maos: [mao("esquerda", 0.55), mao("direita", 0.45)] },
      }),
    ]);
    const ids2 = idsPorLateralidade(r2.observacoes[0]);
    expect(ids2.get("esquerda")).toBe(idEsquerda);
    expect(ids2.get("direita")).toBe(idDireita);
  });

  it("lateralidade desconhecida nao bloqueia a associacao", () => {
    reiniciarContador();
    const motor = criarMotor();
    const r1 = motor.processar([
      obs({
        ms: 0,
        maos: { maos: [mao("esquerda", 0.4), mao("direita", 0.6)] },
      }),
    ]);
    const idEsquerda = idsPorLateralidade(r1.observacoes[0]).get("esquerda");
    expect(idEsquerda).toBeDefined();

    // Sem evidencia de lateralidade nao ha como restringir: a mao herda o ID
    // da entidade esquerda, que esta mais proxima.
    const r2 = motor.processar([
      obs({ ms: 100, maos: { maos: [mao("desconhecida", 0.45)] } }),
    ]);
    expect(idsPorLateralidade(r2.observacoes[0]).get("desconhecida")).toBe(idEsquerda);
  });
});

// ---------------------------------------------------------------------------
