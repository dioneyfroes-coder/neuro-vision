import { describe, expect, it } from "vitest";
import { CONFIG_POLITICA_PADRAO, PoliticaAnalise } from "../src/politica-analise";
import { RastreadorObjetos } from "../src/rastreamento";
import type { MotivoAnalise, ObjetoVisto } from "../src/types";

/**
 * Fase 6.2 — medicao reproduzivel da **qualidade dos eventos** na camada leve
 * (rastreador + politica), sem depender de video real nem do modelo de visao.
 *
 * Roda a percepcao leve sobre roteiros sinteticos com mudancas conhecidas e
 * mede: mudancas detectadas, mudancas perdidas e falsos positivos por minuto.
 * A validacao com video real e anotacoes fica na Fase 7; aqui garantimos que a
 * decisao de acionar a visao e estavel e deterministica em CI.
 */

const INTERVALO_MS = 500; // 2 ticks por segundo
const PASSOS = 120; // 60 segundos

interface Chamada {
  tick: number;
  motivo: MotivoAnalise;
}

interface Medicao {
  chamadas: Chamada[];
  chamadasPorMinuto: number;
  detectadas: number;
  perdidas: number;
  falsosPositivos: number;
  falsosPositivosPorMinuto: number;
  proporcaoDetectada: number;
}

function pessoa(x: number, score = 0.9): ObjetoVisto {
  return {
    nome: "pessoa",
    rotulo: "person",
    score,
    caixa: { xmin: x, ymin: 0, xmax: x + 100, ymax: 100 },
  };
}

/** Roda rastreador + politica sobre um roteiro e compara com as janelas esperadas. */
function medir(
  deteccoesPorTick: (tick: number) => ObjetoVisto[],
  janelasEsperadas: Array<[number, number]>,
  passos = PASSOS
): Medicao {
  const rastreador = new RastreadorObjetos();
  const politica = new PoliticaAnalise(CONFIG_POLITICA_PADRAO);
  const chamadas: Chamada[] = [];

  for (let tick = 0; tick < passos; tick++) {
    const agora = tick * INTERVALO_MS;
    const deteccoes = deteccoesPorTick(tick);
    const quadro = rastreador.processar(deteccoes, agora, {
      timestamp: new Date(agora).toISOString(),
    });
    const melhorConfianca = deteccoes.length
      ? Math.min(...deteccoes.map((d) => d.score))
      : null;
    const decisao = politica.avaliar({
      agora,
      eventos: quadro.eventos,
      melhorConfianca,
      percepcaoValida: true,
    });
    if (decisao.acionar && decisao.motivo !== "sem_acao") {
      politica.registrarChamada(agora);
      chamadas.push({ tick, motivo: decisao.motivo });
    }
  }

  const duracaoMin = (passos * INTERVALO_MS) / 60_000;
  const dentroDaJanela = (tick: number) =>
    janelasEsperadas.some(([inicio, fim]) => tick >= inicio && tick <= fim);
  const atendidas = janelasEsperadas.filter(([inicio, fim]) =>
    chamadas.some((c) => c.tick >= inicio && c.tick <= fim)
  ).length;
  const falsosPositivos = chamadas.filter((c) => !dentroDaJanela(c.tick)).length;

  return {
    chamadas,
    chamadasPorMinuto: chamadas.length / duracaoMin,
    detectadas: atendidas,
    perdidas: janelasEsperadas.length - atendidas,
    falsosPositivos,
    falsosPositivosPorMinuto: falsosPositivos / duracaoMin,
    proporcaoDetectada: atendidas / janelasEsperadas.length,
  };
}

describe("qualidade dos eventos (percepcao leve + politica)", () => {
  it("cena estatica: nao gera falsos positivos apos a primeira analise", () => {
    const m = medir(() => [pessoa(0)], [[0, 0]]);

    expect(m.chamadas).toEqual([{ tick: 0, motivo: "primeira_analise" }]);
    expect(m.falsosPositivos).toBe(0);
    expect(m.falsosPositivosPorMinuto).toBe(0);
  });

  it("detecta 100% das mudancas conhecidas sem falsos positivos", () => {
    const m = medir(
      (tick) => {
        if (tick < 20) return [];
        if (tick < 45) return [pessoa(0)];
        if (tick < 90) return [pessoa(40)];
        return [];
      },
      [
        [0, 0], // primeira analise
        [20, 24], // pessoa aparece
        [45, 49], // pessoa se move
        [90, 95], // pessoa desaparece
      ]
    );

    expect(m.chamadas.map((c) => c.motivo)).toEqual([
      "primeira_analise",
      "nova_entidade",
      "movimento",
      "desaparecimento",
    ]);
    expect(m.perdidas).toBe(0);
    expect(m.proporcaoDetectada).toBe(1);
    expect(m.falsosPositivos).toBe(0);
    expect(m.falsosPositivosPorMinuto).toBe(0);
    expect(m.chamadasPorMinuto).toBeLessThanOrEqual(CONFIG_POLITICA_PADRAO.maxChamadasPorJanela);
  });

  it("nao confunde variacao de score com mudanca de cena", () => {
    const m = medir(() => [pessoa(0, 0.9 - 0.05)], [[0, 0]]);

    expect(m.chamadas).toHaveLength(1);
    expect(m.falsosPositivos).toBe(0);
  });
});
