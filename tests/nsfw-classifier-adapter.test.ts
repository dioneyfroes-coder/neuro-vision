import { describe, expect, it, vi } from "vitest";
import {
  AdaptadorNsfwConjunto,
  LIMITE_IOU_MESCLA_NSFW,
  mesclarMarcacoesNsfw,
} from "../public/perception/adapters/nsfw-classifier.adapter";
import { MODELO_NSFW_CONJUNTO } from "../public/nsfw-onnx";
import { ErroPercepcao } from "../src/erros";
import type {
  ClassificadorNsfw,
  EntradaAdaptador,
  MetricasAdaptador,
  OpcoesDeteccao,
} from "../public/perception/contracts";
import type { MarcacaoNsfw, ResultadoNsfw } from "../src/domain/perception";

/**
 * Conjunto NSFW: o toggle liga **todos** os modelos, cada um no proprio worker,
 * e o resultado e complementar. Estes testes cobrem a regra de mescla (rotulo +
 * IoU) e o isolamento de falhas do conjunto (um modelo cai, os demais seguem;
 * so a falha de todos derruba o subsistema).
 */

function caixa(xmin: number, ymin: number, xmax: number, ymax: number): MarcacaoNsfw["caixa"] {
  return { xmin, ymin, xmax, ymax };
}

function marcacao(
  rotulo: string,
  score: number,
  box: MarcacaoNsfw["caixa"],
  modelo?: string
): MarcacaoNsfw {
  return { rotulo, score, caixa: box, ...(modelo ? { modelo } : {}) };
}

describe("mesclarMarcacoesNsfw", () => {
  it("deduplica o mesmo rotulo na mesma regiao (IoU alto) e soma os modelos", () => {
    const mescladas = mesclarMarcacoesNsfw([
      marcacao("penis", 0.8, caixa(10, 10, 110, 110), "nudenet_320n"),
      marcacao("penis", 0.6, caixa(12, 12, 108, 108), "penis_yolov8m"),
    ]);
    expect(mescladas).toHaveLength(1);
    expect(mescladas[0].score).toBe(0.8);
    expect(mescladas[0].modelo).toBe("nudenet_320n");
    expect(mescladas[0].modelos).toEqual(["nudenet_320n", "penis_yolov8m"]);
  });

  it("preserva o mesmo rotulo em regioes distintas (IoU baixo)", () => {
    const mescladas = mesclarMarcacoesNsfw([
      marcacao("penis", 0.8, caixa(0, 0, 40, 40), "a"),
      marcacao("penis", 0.7, caixa(200, 200, 260, 260), "b"),
    ]);
    expect(mescladas).toHaveLength(2);
    expect(mescladas.map((m) => m.modelos)).toEqual([["a"], ["b"]]);
  });

  it("nunca suprime rotulos diferentes na mesma regiao (modelos complementares)", () => {
    const mescladas = mesclarMarcacoesNsfw([
      marcacao("penis", 0.9, caixa(0, 0, 100, 100), "a"),
      marcacao("make_love", 0.4, caixa(0, 0, 100, 100), "b"),
    ]);
    expect(mescladas).toHaveLength(2);
    expect(mescladas.map((m) => m.rotulo).sort()).toEqual(["make_love", "penis"]);
  });

  it("usa o limite de IoU exportado como fronteira da mescla", () => {
    expect(LIMITE_IOU_MESCLA_NSFW).toBe(0.6);
    // Duas caixas de mesmo tamanho deslocadas: IoU 0.5 < 0.6 -> ficam separadas.
    const deslocadas = mesclarMarcacoesNsfw([
      marcacao("vagina", 0.8, caixa(0, 0, 100, 100), "a"),
      marcacao("vagina", 0.7, caixa(50, 0, 150, 100), "b"),
    ]);
    expect(deslocadas).toHaveLength(2);
  });

  it("ordena por score decrescente e mantem o maior score no topo", () => {
    const mescladas = mesclarMarcacoesNsfw([
      marcacao("nipple", 0.3, caixa(0, 0, 10, 10), "a"),
      marcacao("penis", 0.9, caixa(50, 50, 60, 60), "b"),
      marcacao("anus", 0.5, caixa(20, 20, 30, 30), "c"),
    ]);
    expect(mescladas.map((m) => m.rotulo)).toEqual(["penis", "anus", "nipple"]);
  });

  it("aceita lista vazia", () => {
    expect(mesclarMarcacoesNsfw([])).toEqual([]);
  });
});

/** Adaptador de modelo unico controlavel para exercitar o conjunto. */
class AdaptadorFalso implements ClassificadorNsfw {
  readonly id = "nsfw";
  readonly metricas: MetricasAdaptador = {};
  readonly modelo: string | null = null;
  aoStatus?: (mensagem: string) => void;

  constructor(
    readonly chave: string,
    private readonly opcoes: {
      falharCarga?: boolean;
      falharAvaliacao?: boolean;
      resultado?: ResultadoNsfw;
    } = {}
  ) {}

  async carregar(modelo: string): Promise<void> {
    this.metricas.tempoCargaMs = 1;
    this.metricas.dispositivo = "wasm";
    this.metricas.modelo = modelo;
    if (this.opcoes.falharCarga) {
      this.metricas.status = "indisponivel";
      this.metricas.motivoFalha = `${this.chave} quebrou na carga`;
      throw new Error(`${this.chave} quebrou na carga`);
    }
    this.metricas.status = "ok";
  }

  async avaliar(
    _entrada: EntradaAdaptador,
    _opcoes?: OpcoesDeteccao
  ): Promise<ResultadoNsfw> {
    this.metricas.tempoInferenciaMs = 2;
    if (this.opcoes.falharAvaliacao) {
      this.metricas.status = "indisponivel";
      this.metricas.motivoFalha = `${this.chave} quebrou na avaliacao`;
      throw new Error(`${this.chave} quebrou na avaliacao`);
    }
    const resultado =
      this.opcoes.resultado ?? { marcacoes: [], modelo: this.chave, resumo: "nenhuma marcacao" };
    this.metricas.status = resultado.marcacoes.length ? "ok" : "sem_resultado";
    return resultado;
  }

  encerrar(): void {
    this.metricas.status = "nao_carregado";
  }
}

function criarConjunto(
  opcoes: Record<string, ConstructorParameters<typeof AdaptadorFalso>[1]>
): AdaptadorNsfwConjunto {
  const chaves = Object.keys(opcoes);
  return new AdaptadorNsfwConjunto({
    modelos: chaves,
    criarAdaptador: (modelo) => new AdaptadorFalso(modelo, opcoes[modelo]),
  });
}

const ENTRADA: EntradaAdaptador = { imagem: "data:image/png;base64,AAAA" };

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
});
