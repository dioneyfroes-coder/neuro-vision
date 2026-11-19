import { describe, expect, it, vi } from "vitest";
import { AdaptadorNsfwConjunto } from "../../public/perception/adapters/nsfw-classifier.adapter";
import { MODELO_NSFW_CONJUNTO } from "../../public/nsfw-onnx";
import { ErroPercepcao } from "../../src/erros";
import { AdaptadorFalso, ENTRADA, caixa, criarConjunto, marcacao } from "../helpers/nsfw-classifier-adapter";

describe("AdaptadorNsfwConjunto", () => {
  it("carrega todos os modelos e marca o id composto", async () => {
    const conjunto = criarConjunto({ a: {}, b: {} });
    await conjunto.carregar(MODELO_NSFW_CONJUNTO);
    expect(conjunto.modelo).toBe(MODELO_NSFW_CONJUNTO);
    expect(conjunto.metricas.modelos).toEqual(["a", "b"]);
    expect(conjunto.metricas.status).toBe("ok");
    expect(conjunto.metricas.telemetriaModelos?.map((t) => t.modelo)).toEqual(["a", "b"]);
    expect(conjunto.metricas.telemetriaModelos?.every((t) => t.status === "ok")).toBe(true);
  });

  it("isola a falha de carga de um modelo e segue com os demais", async () => {
    const conjunto = criarConjunto({ a: {}, b: { falharCarga: true } });
    await expect(conjunto.carregar(MODELO_NSFW_CONJUNTO)).resolves.toBeUndefined();
    expect(conjunto.modelo).toBe(MODELO_NSFW_CONJUNTO);
    expect(conjunto.metricas.modelos).toEqual(["a"]);
    expect(conjunto.metricas.motivoFalha).toContain("b quebrou na carga");
    const telemetriaB = conjunto.metricas.telemetriaModelos?.find((t) => t.modelo === "b");
    expect(telemetriaB?.status).toBe("indisponivel");
    expect(telemetriaB?.motivoFalha).toContain("b quebrou na carga");
  });

  it("so fica indisponivel quando todos os modelos falham na carga", async () => {
    const conjunto = criarConjunto({ a: { falharCarga: true }, b: { falharCarga: true } });
    await expect(conjunto.carregar(MODELO_NSFW_CONJUNTO)).rejects.toBeInstanceOf(ErroPercepcao);
    expect(conjunto.modelo).toBeNull();
    expect(conjunto.metricas.status).toBe("indisponivel");
    expect(conjunto.metricas.motivoFalha).toContain("nenhum modelo NSFW carregou");
  });

  it("avalia em paralelo e mescla marcacoes concordantes entre modelos", async () => {
    const conjunto = criarConjunto({
      a: {
        resultado: {
          marcacoes: [marcacao("penis", 0.8, caixa(10, 10, 110, 110))],
          modelo: "a",
        },
      },
      b: {
        resultado: {
          marcacoes: [marcacao("penis", 0.6, caixa(12, 12, 108, 108))],
          modelo: "b",
        },
      },
    });
    await conjunto.carregar(MODELO_NSFW_CONJUNTO);
    const resultado = await conjunto.avaliar(ENTRADA);
    expect(resultado.modelo).toBe(MODELO_NSFW_CONJUNTO);
    expect(resultado.modelos).toEqual(["a", "b"]);
    expect(resultado.marcacoes).toHaveLength(1);
    expect(resultado.marcacoes[0].score).toBe(0.8);
    expect(resultado.marcacoes[0].modelos).toEqual(["a", "b"]);
    expect(conjunto.metricas.telemetriaModelos?.map((t) => t.marcacoes)).toEqual([1, 1]);
  });

  it("isola a falha de avaliacao de um modelo e preserva o resultado dos demais", async () => {
    const conjunto = criarConjunto({
      a: {
        resultado: {
          marcacoes: [marcacao("vagina", 0.7, caixa(0, 0, 50, 50))],
          modelo: "a",
        },
      },
      b: { falharAvaliacao: true },
    });
    await conjunto.carregar(MODELO_NSFW_CONJUNTO);
    const resultado = await conjunto.avaliar(ENTRADA);
    expect(resultado.modelos).toEqual(["a"]);
    expect(resultado.marcacoes).toHaveLength(1);
    expect(conjunto.metricas.status).toBe("ok");
    expect(conjunto.metricas.motivoFalha).toContain("b quebrou na avaliacao");
    expect(conjunto.metricas.telemetriaModelos?.find((t) => t.modelo === "b")?.status).toBe(
      "indisponivel"
    );
  });

  it("so fica indisponivel quando todos os modelos falham na avaliacao", async () => {
    const conjunto = criarConjunto({
      a: { falharAvaliacao: true },
      b: { falharAvaliacao: true },
    });
    await conjunto.carregar(MODELO_NSFW_CONJUNTO);
    await expect(conjunto.avaliar(ENTRADA)).rejects.toBeInstanceOf(ErroPercepcao);
    expect(conjunto.metricas.status).toBe("indisponivel");
    expect(conjunto.metricas.motivoFalha).toContain("nenhum modelo NSFW respondeu");
  });

  it("nao avalia antes de carregar", async () => {
    const conjunto = criarConjunto({ a: {} });
    await expect(conjunto.avaliar(ENTRADA)).rejects.toBeInstanceOf(ErroPercepcao);
  });

  it("encerra todos os modelos e limpa a telemetria", async () => {
    const conjunto = criarConjunto({ a: {}, b: {} });
    await conjunto.carregar(MODELO_NSFW_CONJUNTO);
    conjunto.encerrar();
    expect(conjunto.modelo).toBeNull();
    expect(conjunto.metricas.modelos).toEqual([]);
    expect(conjunto.metricas.telemetriaModelos).toEqual([]);
  });
});

describe("AdaptadorNsfwConjunto - fabrica default", () => {
  it("cria um adaptador por modelo (um worker por modelo) e nao compartilha", async () => {
    const criados: string[] = [];
    const conjunto = new AdaptadorNsfwConjunto({
      modelos: ["x", "y"],
      criarAdaptador: (modelo) => {
        criados.push(modelo);
        return new AdaptadorFalso(modelo, {});
      },
    });
    await conjunto.carregar(MODELO_NSFW_CONJUNTO);
    expect(criados).toEqual(["x", "y"]);
    // Cada modelo tem sua propria instancia/telemetria.
    expect(new Set(conjunto.metricas.telemetriaModelos?.map((t) => t.modelo)).size).toBe(2);
    vi.restoreAllMocks();
  });

  it("propaga o motivo de fallback por modelo e no agregado do subsistema", async () => {
    const conjunto = criarConjunto({
      a: {},
      b: { motivoFallback: "worker de b indisponivel; usando a thread principal" },
    });
    await conjunto.carregar(MODELO_NSFW_CONJUNTO);
    const telemetriaB = conjunto.metricas.telemetriaModelos?.find((t) => t.modelo === "b");
    expect(telemetriaB?.motivoFallback).toContain("thread principal");
    expect(telemetriaB?.status).toBe("ok");
    expect(conjunto.metricas.motivoFallback).toContain("b: worker de b indisponivel");
    // O modelo que rodou no worker nao ganha motivo de fallback.
    const telemetriaA = conjunto.metricas.telemetriaModelos?.find((t) => t.modelo === "a");
    expect(telemetriaA?.motivoFallback).toBeUndefined();
  });
});
