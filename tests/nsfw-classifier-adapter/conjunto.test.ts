import { describe, expect, it, vi } from "vitest";
import { AdaptadorNsfwConjunto } from "../../public/perception/adapters/nsfw-classifier.adapter";
import { MODELO_NSFW_CONJUNTO } from "../../public/nsfw-onnx";
import { ErroPercepcao } from "../../src/erros";
import {
  AdaptadorFalso,
  ENTRADA,
  caixa,
  criarConjunto,
  criarConjuntoComAdaptadores,
  marcacao,
} from "../helpers/nsfw-classifier-adapter";

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

describe("AdaptadorNsfwConjunto - carga parcial, retry e descarte (Fase 1)", () => {
  it("nao chama em nenhuma inferencia o modelo que falhou na carga", async () => {
    const { conjunto, adaptadores } = criarConjuntoComAdaptadores({
      a: { resultado: { marcacoes: [], modelo: "a", resumo: "nenhuma marcacao" } },
      b: { falharCarga: true },
    });
    await conjunto.carregar(MODELO_NSFW_CONJUNTO);

    const primeiro = await conjunto.avaliar(ENTRADA);
    const segundo = await conjunto.avaliar(ENTRADA);

    expect(primeiro.modelos).toEqual(["a"]);
    expect(segundo.modelos).toEqual(["a"]);
    expect(adaptadores.get("a")?.contagemAvaliacoes).toBe(2);
    expect(adaptadores.get("b")?.contagemAvaliacoes).toBe(0);
    expect(adaptadores.get("b")?.contagemCargas).toBe(1);

    // A telemetria do modelo indisponivel e preservada, inclusive apos inferir.
    const telemetriaB = conjunto.metricas.telemetriaModelos?.find((t) => t.modelo === "b");
    expect(telemetriaB?.status).toBe("indisponivel");
    expect(telemetriaB?.motivoFalha).toContain("b quebrou na carga");
    expect(telemetriaB?.marcacoes).toBeUndefined();
    expect(conjunto.metricas.motivoFalha).toContain("b quebrou na carga");
  });

  it("o retry explicito recupera o modelo sem duplicar workers", async () => {
    const { conjunto, adaptadores } = criarConjuntoComAdaptadores({ a: {}, b: { falharCarga: true } });
    await conjunto.carregar(MODELO_NSFW_CONJUNTO);
    expect(conjunto.metricas.modelos).toEqual(["a"]);

    adaptadores.get("b")?.permitirRecarga();
    await conjunto.carregar(MODELO_NSFW_CONJUNTO);

    expect(conjunto.metricas.modelos).toEqual(["a", "b"]);
    expect(adaptadores.get("b")?.contagemCargas).toBe(2);
    // A fabrica so foi chamada uma vez por modelo: nao ha worker duplicado.
    expect(new Set(conjunto.metricas.telemetriaModelos?.map((t) => t.modelo)).size).toBe(2);
    expect(conjunto.metricas.telemetriaModelos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ modelo: "b", status: "ok", tempoCargaMs: 1 }),
      ])
    );
    expect(conjunto.metricas.motivoFalha).toBeUndefined();

    const resultado = await conjunto.avaliar(ENTRADA);
    expect(resultado.modelos).toEqual(["a", "b"]);
    expect(adaptadores.get("b")?.contagemAvaliacoes).toBe(1);
  });

  it("encerra inclusive o modelo que falhou na carga e e idempotente", async () => {
    const { conjunto, adaptadores } = criarConjuntoComAdaptadores({ a: {}, b: { falharCarga: true } });
    await conjunto.carregar(MODELO_NSFW_CONJUNTO);
    conjunto.encerrar();
    conjunto.encerrar();

    expect(adaptadores.get("a")?.contagemEncerramentos).toBe(1);
    expect(adaptadores.get("b")?.contagemEncerramentos).toBe(1);
    expect(conjunto.metricas.modelos).toEqual([]);
    expect(conjunto.metricas.telemetriaModelos).toEqual([]);
    expect(conjunto.metricas.status).toBe("nao_carregado");
    expect(conjunto.metricas.motivoFalha).toBeUndefined();
    await expect(conjunto.avaliar(ENTRADA)).rejects.toBeInstanceOf(ErroPercepcao);
  });

  it("um erro no descarte de um modelo nao impede a liberacao dos demais", async () => {
    const { conjunto, adaptadores } = criarConjuntoComAdaptadores({
      a: {},
      b: { falharEncerramento: true },
      c: {},
    });
    await conjunto.carregar(MODELO_NSFW_CONJUNTO);
    expect(() => conjunto.encerrar()).not.toThrow();
    expect(adaptadores.get("a")?.contagemEncerramentos).toBe(1);
    expect(adaptadores.get("b")?.contagemEncerramentos).toBe(1);
    expect(adaptadores.get("c")?.contagemEncerramentos).toBe(1);
  });

  it("uma falha de inferencia e transitoria e nao remove o modelo da proxima avaliacao", async () => {
    const { conjunto, adaptadores } = criarConjuntoComAdaptadores({
      a: {},
      b: { falharAvaliacao: true },
    });
    await conjunto.carregar(MODELO_NSFW_CONJUNTO);

    await expect(conjunto.avaliar(ENTRADA)).resolves.toMatchObject({ modelos: ["a"] });
    adaptadores.get("b")?.permitirAvaliacao();
    await expect(conjunto.avaliar(ENTRADA)).resolves.toMatchObject({ modelos: ["a", "b"] });
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
