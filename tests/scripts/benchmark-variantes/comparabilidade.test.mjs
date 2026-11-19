import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  avaliarComparabilidade,
  resumoDoClipe,
} from "../../../scripts/benchmark-variantes.mjs";

// ---------------------------------------------------------------------------
// Identidade dos clipes (mesmos bytes entre variantes)
// ---------------------------------------------------------------------------

describe("resumoDoClipe", () => {
  let dir;
  afterAll(() => dir && rm(dir, { recursive: true, force: true }));

  it("registra tamanho e SHA-256 estavel do clipe", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "neuro-bench-"));
    const arquivo = path.join(dir, "clipe.webm");
    await writeFile(arquivo, "conteudo-do-clipe", "utf8");
    const a = await resumoDoClipe(arquivo);
    const b = await resumoDoClipe(arquivo);
    expect(a.tamanhoBytes).toBe(17);
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(b.sha256).toBe(a.sha256);
  });

  it("devolve nulls quando o arquivo nao existe", async () => {
    const r = await resumoDoClipe(path.join(tmpdir(), "neuro-bench-nao-existe.webm"));
    expect(r).toEqual({ tamanhoBytes: null, sha256: null });
  });
});

// ---------------------------------------------------------------------------
// Criterio de comparabilidade (o harness nao conclui com dados invalidos)
// ---------------------------------------------------------------------------

describe("avaliarComparabilidade", () => {
  const resultadoComparavel = (letra, extra = {}) => {
    const L = letra.toLowerCase();
    return {
      variante: { letra },
      // 10 ciclos concluidos = minimo estatistico padrao; assim os casos
      // "conclusivos" realmente exercitam comparabilidade + suficiencia.
      desempenho: { ciclos: 10, ciclosConcluidos: 10, cancelados: 0 },
      qualidade: {
        consolidado: {
          clipes: 5,
          clipesEsperados: 5,
          f1: 0.8,
          precisao: 0.8,
          recall: 0.8,
          falsosPositivosPorMinuto: 0,
        },
      },
      arquivoEventos: `logs/eventos-${letra}.jsonl`,
      arquivoCiclos: "logs/ciclos.jsonl",
      registros: [{ sessionId: `sessao-variante-${L}`, cycleId: `c-${L}` }],
      sessaoExplicita: false,
      modelos: { visao: ["qwen2.5-vl-3b-instruct"], deteccao: ["Xenova/yolos-tiny"] },
      ...extra,
    };
  };
  const quatro = () => ["A", "B", "C", "D"].map((l) => resultadoComparavel(l));
  const modelo = "qwen2.5-vl-3b-instruct";

  it("e conclusivo com ciclos concluidos, modelo verificado e qualidade propria", () => {
    const r = avaliarComparabilidade(quatro(), { modeloGlobal: modelo });
    expect(r.comparavel).toBe(true);
    expect(r.estatisticamenteSuficiente).toBe(true);
    expect(r.conclusivo).toBe(true);
    expect(r.problemas).toEqual([]);
    expect(r.limitacoesEstatisticas).toEqual([]);
    expect(r.minCiclosValidos).toBe(2);
    expect(r.minAmostrasEstatisticas).toBe(10);
    expect(r.porVariante).toHaveLength(4);
    expect(r.porVariante[1]).toMatchObject({
      letra: "B",
      ciclosConcluidos: 10,
      qualidade: true,
      amostrasEstatisticas: 10,
      estatisticamenteSuficiente: true,
    });
  });

  it("distingue comparavel de estatisticamente suficiente", () => {
    const resultados = ["B", "D"].map((l) =>
      resultadoComparavel(l, { desempenho: { ciclos: 3, ciclosConcluidos: 3, cancelados: 0 } })
    );
    const r = avaliarComparabilidade(resultados, { modeloGlobal: modelo });
    // Dados validos: comparaveis. Mas 3 ciclos nao sustentam IC95% da mediana.
    expect(r.comparavel).toBe(true);
    expect(r.estatisticamenteSuficiente).toBe(false);
    expect(r.conclusivo).toBe(false);
    expect(r.problemas).toEqual([]);
    expect(r.limitacoesEstatisticas).toHaveLength(2);
    expect(r.limitacoesEstatisticas[0]).toContain("minimo estatistico 10");
    expect(r.porVariante.find((p) => p.letra === "B")).toMatchObject({
      amostrasEstatisticas: 3,
      estatisticamenteSuficiente: false,
    });
  });

  it("um unico ciclo nunca e conclusivo por padrao", () => {
    const resultados = ["B", "D"].map((l) =>
      resultadoComparavel(l, { desempenho: { ciclos: 1, ciclosConcluidos: 1, cancelados: 0 } })
    );
    const r = avaliarComparabilidade(resultados, { modeloGlobal: modelo });
    expect(r.comparavel).toBe(false);
    expect(r.conclusivo).toBe(false);
    expect(r.problemas.filter((p) => p.includes("abaixo do minimo 2"))).toHaveLength(2);
  });

  it("recusa quando uma variante nao tem ciclo concluido", () => {
    const resultados = quatro();
    resultados[1] = resultadoComparavel("B", {
      desempenho: { ciclos: 2, ciclosConcluidos: 0, cancelados: 2 },
    });
    const r = avaliarComparabilidade(resultados, { modeloGlobal: modelo });
    expect(r.conclusivo).toBe(false);
    expect(r.problemas.some((p) => p.startsWith("B: 0 ciclo(s) concluido(s)"))).toBe(true);
  });

  it("recusa quando o modelo multimodal nao foi observado", () => {
    const resultados = quatro();
    resultados[2] = resultadoComparavel("C", { modelos: { visao: [], deteccao: ["Xenova/yolos-tiny"] } });
    const r = avaliarComparabilidade(resultados, { modeloGlobal: modelo });
    expect(r.conclusivo).toBe(false);
    expect(r.problemas.some((p) => p.includes("C: modelo multimodal nao observado"))).toBe(true);
  });

  it("recusa quando o mesmo arquivo de eventos serve a mais de uma variante", () => {
    const resultados = quatro();
    resultados[1] = resultadoComparavel("B", { arquivoEventos: "logs/eventos-comum.jsonl" });
    resultados[2] = resultadoComparavel("C", { arquivoEventos: "logs/eventos-comum.jsonl" });
    const r = avaliarComparabilidade(resultados, { modeloGlobal: modelo });
    expect(r.conclusivo).toBe(false);
    expect(r.problemas.some((p) => p.includes("arquivo de eventos compartilhado"))).toBe(true);
  });

  it("recusa reutilizar o mesmo arquivo de eventos para clipes diferentes", () => {
    const resultados = quatro();
    resultados[0] = resultadoComparavel("A", {
      arquivosEventosPorClipe: [
        { clipe: "car-detection.mp4", arquivo: "logs/a-car.jsonl" },
        { clipe: "classroom.mp4", arquivo: "logs/a-car.jsonl" },
      ],
    });
    const r = avaliarComparabilidade(resultados, { modeloGlobal: modelo });
    expect(r.conclusivo).toBe(false);
    expect(r.problemas.some((p) => p.includes("mesmo arquivo de eventos reutilizado por varios clipes"))).toBe(true);
  });

  it("recusa quando o mesmo ciclo aparece em duas variantes", () => {
    const resultados = quatro();
    resultados[2] = resultadoComparavel("C", {
      registros: [{ sessionId: "sessao-variante-b", cycleId: "c-b" }],
    });
    const r = avaliarComparabilidade(resultados, { modeloGlobal: modelo });
    expect(r.conclusivo).toBe(false);
    expect(r.problemas.some((p) => p.includes("aparece nas variantes"))).toBe(true);
  });

  it("exige o minimo de ciclos concluidos informado", () => {
    const resultados = ["B", "D"].map((l) =>
      resultadoComparavel(l, { desempenho: { ciclos: 1, ciclosConcluidos: 1, cancelados: 0 } })
    );
    const r = avaliarComparabilidade(resultados, { modeloGlobal: modelo, minCiclosValidos: 2 });
    expect(r.comparavel).toBe(false);
    expect(r.conclusivo).toBe(false);
    expect(r.problemas.filter((p) => p.includes("abaixo do minimo 2"))).toHaveLength(2);
  });

  it("recusa sem modelo multimodal registrado", () => {
    const r = avaliarComparabilidade(quatro(), { modeloGlobal: "" });
    expect(r.conclusivo).toBe(false);
    expect(r.problemas.some((p) => p.includes("modelo multimodal nao registrado"))).toBe(true);
  });

  it("recusa sem qualidade consolidada", () => {
    const resultados = quatro();
    resultados[3] = resultadoComparavel("D", { qualidade: { consolidado: null } });
    const r = avaliarComparabilidade(resultados, { modeloGlobal: modelo });
    expect(r.conclusivo).toBe(false);
    expect(r.problemas.some((p) => p.includes("D: sem qualidade consolidada"))).toBe(true);
  });

  it("recusa qualidade com movimentos sem classificação de escopo", () => {
    const resultados = quatro();
    resultados[1] = resultadoComparavel("B", {
      qualidade: { consolidado: { f1: 0.8, semClassificacaoEscopo: 1 } },
    });
    const r = avaliarComparabilidade(resultados, { modeloGlobal: modelo });
    expect(r.conclusivo).toBe(false);
    expect(r.problemas.some((p) => p.includes("B: 1 movimento(s) sem classificacao de escopo"))).toBe(true);
  });

  it("recusa qualidade parcial quando faltam logs de alguns clipes EVAL", () => {
    const resultados = quatro();
    resultados[2] = resultadoComparavel("C", {
      qualidade: {
        consolidado: {
          clipes: 4,
          clipesEsperados: 5,
          f1: 0.8,
          precisao: 0.8,
          recall: 0.8,
          falsosPositivosPorMinuto: 0,
        },
      },
    });
    const r = avaliarComparabilidade(resultados, { modeloGlobal: modelo });
    expect(r.conclusivo).toBe(false);
    expect(r.problemas.some((p) => p.includes("C: qualidade parcial: 4/5 clipe(s) avaliados"))).toBe(true);
  });

  it("com --sem-qualidade conclui apenas pelo desempenho (sem eventos/qualidade)", () => {
    const resultados = quatro().map((r) => ({ ...r, arquivoEventos: null, qualidade: null }));
    const r = avaliarComparabilidade(resultados, { modeloGlobal: modelo, exigirQualidade: false });
    expect(r.conclusivo).toBe(true);
    expect(r.problemas).toEqual([]);
  });

  it("aceita sessao explicita mesmo quando o sessionId nao casa com a heuristica", () => {
    const resultados = quatro();
    resultados[1] = resultadoComparavel("B", {
      sessaoExplicita: true,
      registros: [{ sessionId: "sessao-custom", cycleId: "c-b" }],
    });
    const r = avaliarComparabilidade(resultados, { modeloGlobal: modelo });
    expect(r.conclusivo).toBe(true);
  });

  it("recusa comparar uma unica variante", () => {
    const r = avaliarComparabilidade([resultadoComparavel("D")], { modeloGlobal: modelo });
    expect(r.conclusivo).toBe(false);
    expect(r.problemas.some((p) => p.includes("menos de duas variantes"))).toBe(true);
  });

  it("usa o regime AQUECIDO para a contagem quando ha warm-up separado", () => {
    const resultados = quatro();
    // Bruto tem 2 concluidos; aquecido tem 0 (ambos eram warm-up).
    resultados[1] = resultadoComparavel("B", {
      desempenho: { ciclos: 2, ciclosConcluidos: 2, cancelados: 0 },
      desempenhoAquecido: { ciclos: 2, ciclosConcluidos: 0, cancelados: 0 },
      warmups: 2,
    });
    const r = avaliarComparabilidade(resultados, { modeloGlobal: modelo });
    expect(r.conclusivo).toBe(false);
    expect(r.problemas.some((p) => p.startsWith("B: 0 ciclo(s) concluido(s)"))).toBe(true);
    expect(r.porVariante.find((p) => p.letra === "B")).toMatchObject({ ciclosConcluidos: 0, warmups: 2 });
  });
});