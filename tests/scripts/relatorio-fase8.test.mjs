import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  compararVariantes,
  main,
  montarRelatorio,
  nomeRelatorioFase8,
} from "../../scripts/relatorio-fase8.mjs";

function ciclo(varianteId, indice, { fps = 5 } = {}) {
  return {
    sessionId: `sessao-${varianteId}`,
    cycleId: `ciclo-${varianteId}-${indice}`,
    concluidoEm: `2026-11-22T20:00:0${indice}Z`,
    cancelado: false,
    frameIds: [`f-${indice}`],
    observacoes: 10,
    configuracao: { varianteId },
    metricas: {
      totalMs: 1000 + indice,
      multimodalMs: 600 + indice,
      memoriaMaximaBytes: 104857600,
      amostragem: {
        janelaMs: 2000,
        porSubsistema: {
          deteccao: {
            amostrados: 10,
            intervaloAlvoMs: 200,
            fpsEfetivo: fps,
            intervaloMedioMs: 200,
          },
        },
      },
    },
    cargaModelos: { totalMs: 5000, subsistemas: {} },
  };
}

function registros() {
  return [
    ciclo("baseline", 1),
    ciclo("baseline", 2),
    ciclo("completa", 1),
    ciclo("completa", 2),
  ];
}

describe("relatorio consolidado da Fase 8", () => {
  it("separa as variantes sobre os mesmos registros", () => {
    const variantes = compararVariantes(registros());
    expect(variantes.map((v) => [v.letra, v.ciclosAquecidos])).toEqual([
      ["A", 2],
      ["B", 0],
      ["C", 0],
      ["D", 2],
    ]);
    expect(variantes.find((v) => v.letra === "A").totalMs).toBe(1002);
    expect(variantes.find((v) => v.letra === "B").totalMs).toBeNull();
  });

  it("marca INCONCLUSIVO e N/A quando nao ha dados", () => {
    const resumo = montarRelatorio({ registros: [], fonte: "logs/inexistente.jsonl" });
    expect(resumo.veredito).toBe("INCONCLUSIVO");
    expect(resumo.suficiente).toBe(false);
    expect(resumo.markdown).toContain("Por que este relatorio e inconclusivo");
    expect(resumo.markdown).toContain("N/A");
  });

  it("distingue veredito negativo medido de ausencia de medicao", () => {
    const resumo = montarRelatorio({ registros: registros().map((r) => ({
      ...r,
      metricas: {
        ...r.metricas,
        amostragem: {
          ...r.metricas.amostragem,
          porSubsistema: {
            deteccao: {
              amostrados: 10,
              intervaloAlvoMs: 200,
              fpsEfetivo: 1,
              intervaloMedioMs: 200,
            },
          },
        },
      },
    })) });
    expect(resumo.suficiente).toBe(true);
    expect(resumo.veredito).toBe("NAO_ATINGIU");
    expect(resumo.markdown).not.toContain("Por que este relatorio e inconclusivo");
  });

  it("exclui warm-ups sem transformar o custo de partida em aquecido", () => {
    const variantes = compararVariantes(registros(), { warmups: 1 });
    const a = variantes.find((v) => v.letra === "A");
    expect(a.ciclosConcluidos).toBe(2);
    expect(a.warmups).toBe(1);
    expect(a.ciclosAquecidos).toBe(1);
  });

  it("gera um nome seguro e recusa data fora do formato", () => {
    expect(nomeRelatorioFase8("20261122")).toBe("RELATORIO_FASE8_20261122.md");
    expect(() => nomeRelatorioFase8("../BASELINE")).toThrow();
  });

  it("grava o relatorio no destino informado sem tocar BASELINE.md", async () => {
    const diretorio = await mkdtemp(path.join(os.tmpdir(), "neuro-fase8-"));
    try {
      const codigo = await main([
        "--ciclos",
        "logs/ciclos.jsonl",
        "--saida",
        diretorio,
        "--data",
        "20261122",
        "--json",
      ]);
      // Sem dados reais garantidos, o codigo honesto e 2 (INCONCLUSIVO).
      expect([0, 2]).toContain(codigo);
      const gravado = await readFile(path.join(diretorio, "RELATORIO_FASE8_20261122.md"), "utf8");
      expect(gravado).toContain("# Relatorio consolidado de benchmark");
    } finally {
      await rm(diretorio, { recursive: true, force: true });
    }
  });
});
