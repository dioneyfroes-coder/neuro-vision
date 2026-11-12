import { describe, expect, it } from "vitest";
import type { MaoDetectada, PessoaPose, PontoCorporal } from "../src/domain";
import {
  AvaliadorPoseSexual,
  CONFIG_REGRAS_POSE_SEXUAL_PADRAO,
} from "../public/temporal/regras-pose";

/**
 * Fase 7.2: regras geometricas de pose compativel. Elas sao indicios, nao
 * prova de ato sexual; os testes fixam os limiares e a ausencia de conclusao
 * quando faltam pontos confiaveis.
 */

function ponto(x: number, y: number, confianca = 0.9): PontoCorporal {
  return { x, y, confianca };
}

function pose(opcoes: {
  quadrilEsq?: PontoCorporal;
  quadrilDir?: PontoCorporal;
  joelhoEsq?: PontoCorporal;
  joelhoDir?: PontoCorporal;
  tornozeloEsq?: PontoCorporal;
  tornozeloDir?: PontoCorporal;
  punhoEsq?: PontoCorporal;
  punhoDir?: PontoCorporal;
  entidadeId?: string;
}): PessoaPose {
  const pontos: PontoCorporal[] = Array.from({ length: 17 }, () => ponto(0.5, 0.5));
  pontos[11] = opcoes.quadrilEsq ?? ponto(0.4, 0.5);
  pontos[12] = opcoes.quadrilDir ?? ponto(0.6, 0.5);
  pontos[13] = opcoes.joelhoEsq ?? ponto(0.45, 0.7);
  pontos[14] = opcoes.joelhoDir ?? ponto(0.55, 0.7);
  pontos[15] = opcoes.tornozeloEsq ?? ponto(0.45, 0.9);
  pontos[16] = opcoes.tornozeloDir ?? ponto(0.55, 0.9);
  pontos[9] = opcoes.punhoEsq ?? ponto(0.5, 0.3);
  pontos[10] = opcoes.punhoDir ?? ponto(0.5, 0.3);
  return { entidadeId: opcoes.entidadeId ?? "p1", pontos, confianca: 0.9 };
}

function mao(x: number, y: number): MaoDetectada {
  return {
    lateralidade: "direita",
    landmarks: [
      { x, y },
      { x: x + 0.01, y: y + 0.01 },
    ],
  };
}

describe("AvaliadorPoseSexual", () => {
  it("marca mao/punho proximo da regiao genital", () => {
    const avaliador = new AvaliadorPoseSexual();
    // Quadril de 0.2 de largura; genital estimada em (0.5, 0.57).
    const resultado = avaliador.avaliar(
      pose({ punhoEsq: ponto(0.5, 0.58), punhoDir: ponto(0.2, 0.2) }),
      [],
      0
    );
    expect(resultado.regras).toContain("mao_proxima_genital");
    expect(resultado.compativel).toBe(true);
    expect(resultado.confianca).toBeGreaterThanOrEqual(
      CONFIG_REGRAS_POSE_SEXUAL_PADRAO.limiarCompativel
    );
    expect(resultado.evidencias.join(" ")).toContain("mao_proxima_genital");
  });

  it("usa o centroide da mao detectada, nao apenas o punho da pose", () => {
    const avaliador = new AvaliadorPoseSexual();
    const resultado = avaliador.avaliar(
      pose({ punhoEsq: ponto(0.2, 0.2), punhoDir: ponto(0.2, 0.2) }),
      [mao(0.5, 0.58)],
      0
    );
    expect(resultado.regras).toContain("mao_proxima_genital");
  });

  it("marca pernas abertas quando joelhos/tornozelos superam a razao do quadril", () => {
    const avaliador = new AvaliadorPoseSexual();
    const resultado = avaliador.avaliar(
      pose({
        punhoEsq: ponto(0.2, 0.2),
        punhoDir: ponto(0.2, 0.2),
        joelhoEsq: ponto(0.3, 0.7),
        joelhoDir: ponto(0.7, 0.7),
      }),
      [],
      0
    );
    expect(resultado.regras).toContain("pernas_abertas");
    // Pernas abertas sozinhas nao atingem o limiar de pose compativel.
    expect(resultado.compativel).toBe(false);
  });

  it("nao confunde bracos com pernas: joelhos acima do quadril nao contam", () => {
    const avaliador = new AvaliadorPoseSexual();
    const resultado = avaliador.avaliar(
      pose({
        punhoEsq: ponto(0.2, 0.2),
        punhoDir: ponto(0.2, 0.2),
        joelhoEsq: ponto(0.3, 0.4),
        joelhoDir: ponto(0.7, 0.4),
      }),
      [],
      0
    );
    expect(resultado.regras).not.toContain("pernas_abertas");
  });

  it("detecta movimento ritmico do punho em uma janela de frames", () => {
    const avaliador = new AvaliadorPoseSexual();
    const alturas = [0.2, 0.4, 0.2, 0.4, 0.2, 0.4];
    let ultimo = avaliador.avaliar(pose({}), [], 0);
    for (let i = 0; i < alturas.length; i += 1) {
      ultimo = avaliador.avaliar(
        pose({
          punhoEsq: ponto(0.5, alturas[i]),
          punhoDir: ponto(0.2, 0.2),
        }),
        [],
        (i + 1) * 100
      );
    }
    expect(ultimo.regras).toContain("movimento_ritmico_punho");
    expect(ultimo.evidencias.join(" ")).toContain("movimento_ritmico_punho");
  });

  it("nao marca ritmo com deslocamento abaixo da amplitude minima", () => {
    const avaliador = new AvaliadorPoseSexual();
    const alturas = [0.2, 0.205, 0.2, 0.205, 0.2, 0.205];
    let ultimo = avaliador.avaliar(pose({}), [], 0);
    for (let i = 0; i < alturas.length; i += 1) {
      ultimo = avaliador.avaliar(
        pose({
          punhoEsq: ponto(0.5, alturas[i]),
          punhoDir: ponto(0.2, 0.2),
        }),
        [],
        (i + 1) * 100
      );
    }
    expect(ultimo.regras).not.toContain("movimento_ritmico_punho");
  });

  it("sem quadris confiaveis nao estima regiao genital nem inventa regra", () => {
    const avaliador = new AvaliadorPoseSexual();
    const resultado = avaliador.avaliar(
      pose({
        quadrilEsq: ponto(0.4, 0.5, 0.1),
        quadrilDir: ponto(0.6, 0.5, 0.1),
        punhoEsq: ponto(0.5, 0.55),
        punhoDir: ponto(0.5, 0.55),
      }),
      [mao(0.5, 0.55)],
      0
    );
    expect(resultado.regras).toEqual([]);
    expect(resultado.compativel).toBe(false);
    expect(resultado.confianca).toBe(0);
    expect(resultado.evidencias).toEqual(["pose:sem_regra"]);
  });

  it("limpa o historico de ritmo na sessao", () => {
    const avaliador = new AvaliadorPoseSexual();
    const alturas = [0.2, 0.4, 0.2, 0.4];
    for (let i = 0; i < alturas.length; i += 1) {
      avaliador.avaliar(
        pose({ punhoEsq: ponto(0.5, alturas[i]), punhoDir: ponto(0.2, 0.2) }),
        [],
        i * 100
      );
    }
    avaliador.limpar();
    const resultado = avaliador.avaliar(
      pose({ punhoEsq: ponto(0.5, 0.2), punhoDir: ponto(0.2, 0.2) }),
      [],
      500
    );
    expect(resultado.regras).not.toContain("movimento_ritmico_punho");
  });
});
