import { describe, expect, it } from "vitest";
import type { ObservacaoFrame, PacoteCiclo } from "../src/domain";
import { estaIndisponivel, indisponivel } from "../src/domain/perception";
import { montarContextoCiclo } from "../public/interpretation/contexto";
import { MotorTemporalImpl } from "../public/temporal/motor-temporal";

/**
 * Integracao da cadeia percepcao -> rastreamento -> movimento -> contexto.
 *
 * O rastreador atribui IDs estaveis a pessoas e maos; o motor devolve copias
 * enriquecidas das observacoes, e o contexto serializado precisa usar essas
 * copias para calcular `movimento` com o mesmo `trackId` que aparece em
 * `pessoas`/`maos`. Sem essa ligacao, o campo `movimento` fica vazio.
 */

function pontosPessoa(baseX: number, baseY: number) {
  return Array.from({ length: 17 }, (_, i) => ({
    x: baseX + i * 0.002,
    y: baseY + i * 0.002,
    confianca: 0.9,
  }));
}

function observacao(indice: number, deslocamentoX: number): ObservacaoFrame {
  return {
    sessionId: "s1",
    cycleId: "s1-c1",
    frameId: `f${indice + 1}`,
    capturadoEm: new Date(1_700_000_000_000 + indice * 1_000).toISOString(),
    capturadoEmMs: indice * 1_000,
    imagem: `data:image/jpeg;base64,frame${indice}`,
    deteccoes: indisponivel("deteccao", "desativado"),
    pose: {
      pessoas: [{ pontos: pontosPessoa(0.3 + deslocamentoX, 0.4), confianca: 0.9 }],
    },
    maos: {
      maos: [
        {
          lateralidade: "direita",
          landmarks: [
            { x: 0.5 + deslocamentoX, y: 0.6 },
            { x: 0.52 + deslocamentoX, y: 0.58 },
            { x: 0.54 + deslocamentoX, y: 0.56 },
          ],
          gesto: { nome: "mao_aberta", confianca: 0.8 },
        },
      ],
    },
    metricas: {},
  };
}

function pacote(observacoes: ObservacaoFrame[], resumo: PacoteCiclo["resumoTemporal"]): PacoteCiclo {
  return {
    sessionId: "s1",
    cycleId: "s1-c1",
    iniciadoEm: observacoes[0].capturadoEm,
    observacoes,
    eventosTemporais: resumo.eventos,
    resumoTemporal: resumo,
    metricas: {},
  };
}

describe("integracao rastreamento -> contexto", () => {
  it("preserva trackId em pessoas/maos e calcula movimento entre snapshots", () => {
    const motor = new MotorTemporalImpl();
    const originais = [0, 1, 2].map((i) => observacao(i, i * 0.05));

    const resultado = motor.processar(originais);
    expect(resultado.observacoes).toHaveLength(3);

    // As observacoes originais nao sao mutadas: o enriquecimento e por copia.
    expect(originais[0].pose).not.toHaveProperty("pessoas.0.entidadeId");
    expect(originais[0].maos).not.toHaveProperty("maos.0.entidadeId");

    const idsPessoa = resultado.observacoes.map((obs) => {
      if (estaIndisponivel(obs.pose)) return undefined;
      return obs.pose.pessoas[0]?.entidadeId;
    });
    const idsMao = resultado.observacoes.map((obs) => {
      if (estaIndisponivel(obs.maos)) return undefined;
      return obs.maos.maos[0]?.entidadeId;
    });

    expect(idsPessoa[0]).toBeDefined();
    expect(idsPessoa[1]).toBe(idsPessoa[0]);
    expect(idsPessoa[2]).toBe(idsPessoa[0]);
    expect(idsMao[0]).toBeDefined();
    expect(idsMao[1]).toBe(idsMao[0]);
    expect(idsMao[2]).toBe(idsMao[0]);

    const { contexto } = montarContextoCiclo(
      pacote(resultado.observacoes, resultado)
    );

    for (const frame of contexto.frames) {
      expect(frame.pessoas[0]?.trackId).toBe(idsPessoa[0]);
      expect(frame.maos[0]?.trackId).toBe(idsMao[0]);
    }

    // Primeiro frame nao tem posicao anterior; os seguintes acumulam movimento.
    expect(contexto.frames[0].movimento).toEqual([]);
    const movimentoPessoa = contexto.frames[1].movimento.filter((m) => m.tipo === "pessoa");
    const movimentoMao = contexto.frames[1].movimento.filter((m) => m.tipo === "mao");
    expect(movimentoPessoa).toHaveLength(1);
    expect(movimentoMao).toHaveLength(1);
    expect(movimentoPessoa[0]).toMatchObject({
      trackId: idsPessoa[0],
      tipo: "pessoa",
      deslocamento: 0.05,
      direcaoGraus: 90,
      intervaloMs: 1_000,
    });
    expect(movimentoMao[0]).toMatchObject({
      trackId: idsMao[0],
      tipo: "mao",
      deslocamento: 0.05,
      direcaoGraus: 90,
      intervaloMs: 1_000,
    });
    expect(contexto.frames[2].movimento).toHaveLength(2);
  });
});
