import { describe, expect, it } from "vitest";

import {
  agregarAmostragem,
  agregarLatencia,
  aplicarWarmup,
  ehCicloUtil,
  filtrarPorPolitica,
  formatarMarkdown,
  lerArgs,
  lerCiclosJsonl,
  mediana,
  percentil,
  resumirBenchmark,
  SUBSISTEMAS,
} from "../../scripts/benchmark-cadencia.mjs";

/**
 * Fase 1.4 — benchmark da cadencia independente.
 *
 * O script le os ciclos ja persistidos e responde se a meta de 5 FPS foi
 * atingida. Estes testes fixam as garantias que impedem um falso positivo:
 * metrica ausente nunca vira numero, poucos ciclos nao dao veredito e a
 * tolerancia de jitter e aplicada por subsistema.
 */

function ciclo(parcial = {}) {
  return {
    cycleId: "c1",
    observacoes: 5,
    cancelado: false,
    politica: { id: "benchmark-5fps", cadencia: { maosMs: 200, poseMs: 1000, deteccaoMs: 1000 } },
    metricas: {
      amostragem: {
        janelaMs: 800,
        porSubsistema: {
          deteccao: { amostrados: 1, intervaloAlvoMs: 1000 },
          pose: { amostrados: 1, intervaloAlvoMs: 1000 },
          maos: { amostrados: 5, intervaloAlvoMs: 200, intervaloMedioMs: 200, fpsEfetivo: 5 },
        },
      },
    },
    ...parcial,
  };
}

describe("lerCiclosJsonl", () => {
  it("le linhas validas e conta as invalidas sem quebrar", () => {
    const texto = `${JSON.stringify({ cycleId: "a" })}\n\n{quebrado}\n${JSON.stringify({ cycleId: "b" })}\r\n`;
    const { registros, invalidas } = lerCiclosJsonl(texto);
    expect(registros.map((r) => r.cycleId)).toEqual(["a", "b"]);
    expect(invalidas).toBe(1);
  });
});

describe("lerArgs", () => {
  it("usa alvo de 5 FPS e um ciclo minimo por padrao", () => {
    const args = lerArgs([]);
    expect(args.fpsAlvo).toBe(5);
    expect(args.minCiclos).toBe(1);
    expect(args.warmup).toBe(0);
    expect(args.json).toBe(false);
  });

  it("aceita politica, alvo e saida explicitos", () => {
    const args = lerArgs([
      "--politica",
      "benchmark-5fps",
      "--fps-alvo",
      "7",
      "--warmup",
      "2",
      "--min-ciclos",
      "3",
      "--json",
      "--saida",
      "bench/RELATORIO.md",
    ]);
    expect(args).toMatchObject({
      politica: "benchmark-5fps",
      fpsAlvo: 7,
      warmup: 2,
      minCiclos: 3,
      json: true,
    });
    expect(args.saida).toContain("bench");
  });

  it("rejeita opcao desconhecida e valor ausente", () => {
    expect(() => lerArgs(["--inexistente"])).toThrow(/desconhecida/);
    expect(() => lerArgs(["--ciclos"])).toThrow(/Faltou valor/);
  });
});

describe("estatistica", () => {
  it("calcula mediana e P95 por interpolacao", () => {
    expect(mediana([3, 1, 2])).toBe(2);
    expect(mediana([4, 1, 3, 2])).toBe(2.5);
    expect(mediana([])).toBeNull();
    expect(percentil([10, 20, 30, 40, 50], 0.95)).toBe(48);
  });
});

describe("filtros do benchmark", () => {
  it("descarta ciclos cancelados ou sem metricas", () => {
    expect(ehCicloUtil(ciclo())).toBe(true);
    expect(ehCicloUtil(ciclo({ cancelado: true }))).toBe(false);
    expect(ehCicloUtil(ciclo({ metricas: undefined }))).toBe(false);
  });

  it("filtra pela politica aplicada e aplica warmup so nos uteis", () => {
    const registros = [
      ciclo({ cycleId: "a" }),
      ciclo({ cycleId: "b", politica: { id: "operacional" } }),
      ciclo({ cycleId: "c", cancelado: true }),
      ciclo({ cycleId: "d" }),
    ];
    expect(filtrarPorPolitica(registros, "benchmark-5fps").map((r) => r.cycleId)).toEqual([
      "a",
      "c",
      "d",
    ]);
    expect(aplicarWarmup(filtrarPorPolitica(registros, "benchmark-5fps"), 1).map((r) => r.cycleId)).toEqual([
      "c",
      "d",
    ]);
  });
});

describe("agregarAmostragem", () => {
  it("resume cobertura, FPS efetivo e alvo derivado do intervalo", () => {
    const resumo = agregarAmostragem([ciclo()]);
    expect(resumo.ciclosComAmostragem).toBe(1);
    expect(resumo.porSubsistema.maos).toMatchObject({
      ciclos: 1,
      amostrados: 5,
      frames: 5,
      cobertura: 1,
      fpsAlvo: 5,
      fpsEfetivo: 5,
      intervaloAlvoMs: 200,
      atingiu: true,
    });
    // Pose/deteccao amostram 1 de 5 frames: cobertura 0.2 e um unico
    // registro nao fornece taxa efetiva (nao ha intervalo entre amostras).
    expect(resumo.porSubsistema.pose).toMatchObject({
      amostrados: 1,
      cobertura: 0.2,
      fpsAlvo: 1,
      fpsEfetivo: null,
      atingiu: null,
    });
  });

  it("deixa nsfw sem metricas em vez de inventar zero", () => {
    const resumo = agregarAmostragem([ciclo()]);
    expect(resumo.porSubsistema.nsfw).toMatchObject({
      ciclos: 0,
      amostrados: 0,
      cobertura: null,
      fpsAlvo: null,
      fpsEfetivo: null,
      atingiu: null,
    });
    expect(Object.keys(resumo.porSubsistema)).toEqual(SUBSISTEMAS);
  });

  it("aceita 90% do alvo para absorver jitter de captura", () => {
    const jitter = ciclo({
      metricas: {
        amostragem: {
          janelaMs: 840,
          porSubsistema: {
            maos: { amostrados: 5, intervaloAlvoMs: 200, intervaloMedioMs: 210, fpsEfetivo: 4.8 },
          },
        },
      },
    });
    expect(agregarAmostragem([jitter]).porSubsistema.maos.atingiu).toBe(true);
  });

  it("reprova quando o FPS efetivo fica abaixo da tolerancia", () => {
    const lento = ciclo({
      metricas: {
        amostragem: {
          janelaMs: 2400,
          porSubsistema: {
            maos: { amostrados: 5, intervaloAlvoMs: 200, intervaloMedioMs: 600, fpsEfetivo: 1.7 },
          },
        },
      },
    });
    expect(agregarAmostragem([lento]).porSubsistema.maos.atingiu).toBe(false);
  });
});

describe("agregarLatencia", () => {
  it("calcula mediana e P95 por etapa e ignora ausentes", () => {
    const resumo = agregarLatencia([
      ciclo({ metricas: { maosMs: 100, totalMs: 500 } }),
      ciclo({ metricas: { maosMs: 300, totalMs: 900 } }),
      ciclo({ metricas: {} }),
    ]);
    expect(resumo.maosMs).toMatchObject({ amostras: 2, mediana: 200, p95: 290 });
    expect(resumo.capturaMs).toMatchObject({ amostras: 0, mediana: null, p95: null });
  });
});

describe("resumirBenchmark", () => {
  it("nao da veredito sem ciclos suficientes", () => {
    const resumo = resumirBenchmark([ciclo()], { minCiclos: 2 });
    expect(resumo.suficiente).toBe(false);
    expect(resumo.veredito).toBe(false);
    expect(resumo.ciclos).toBe(1);
  });

  it("da veredito positivo quando todos os subsistemas medidos atingem", () => {
    const dois = [
      ciclo({ cycleId: "a" }),
      ciclo({
        cycleId: "b",
        metricas: {
          ...ciclo().metricas,
          amostragem: {
            janelaMs: 800,
            porSubsistema: {
              ...ciclo().metricas.amostragem.porSubsistema,
              pose: { amostrados: 2, intervaloAlvoMs: 1000, intervaloMedioMs: 800, fpsEfetivo: 1.25 },
            },
          },
        },
      }),
    ];
    const resumo = resumirBenchmark(dois, { politica: "benchmark-5fps", minCiclos: 2 });
    expect(resumo).toMatchObject({ politica: "benchmark-5fps", ciclos: 2, suficiente: true, veredito: true });
  });

  it("reprova o benchmark inteiro quando um subsistema medido falha", () => {
    const lento = ciclo({ cycleId: "b", metricas: { ...ciclo().metricas } });
    lento.metricas.amostragem.porSubsistema.maos.fpsEfetivo = 1;
    lento.metricas.amostragem.porSubsistema.maos.intervaloMedioMs = 1000;
    const resumo = resumirBenchmark([ciclo({ cycleId: "a" }), lento], { minCiclos: 2 });
    expect(resumo.veredito).toBe(false);
  });
});

describe("formatarMarkdown", () => {
  it("inclui veredito, amostragem e tabela de latencia", () => {
    const markdown = formatarMarkdown(resumirBenchmark([ciclo()]));
    expect(markdown).toContain("# Benchmark de cadencia da percepcao");
    expect(markdown).toContain("**ATINGIU**");
    expect(markdown).toContain("| maos | 1 | 5 | 5 | 1 | 5 | 5 |");
    expect(markdown).toContain("## Latencia por etapa (ms)");
  });

  it("marca amostra insuficiente e veredito negativo", () => {
    const markdown = formatarMarkdown(resumirBenchmark([], { minCiclos: 5 }));
    expect(markdown).toContain("(amostra insuficiente)");
    expect(markdown).toContain("**NAO ATINGIU**");
  });
});
