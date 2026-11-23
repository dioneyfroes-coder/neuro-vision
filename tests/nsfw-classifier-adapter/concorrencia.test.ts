import { describe, expect, it } from "vitest";
import { AdaptadorNsfwConjunto } from "../../public/perception/adapters/nsfw-classifier.adapter";
import { MODELO_NSFW_CONJUNTO } from "../../public/nsfw-onnx";
import type {
  ClassificadorNsfw,
  EntradaAdaptador,
  MetricasAdaptador,
  OpcoesDeteccao,
} from "../../public/perception/contracts";
import type { MarcacaoNsfw, ResultadoNsfw } from "../../src/domain";
import { ENTRADA, caixa, marcacao } from "../helpers/nsfw-classifier-adapter";

interface OpcoesAtrasado {
  atrasoMs?: number;
  falharAvaliacao?: boolean;
  resultado?: ResultadoNsfw;
  aoIniciar?: () => void;
  aoConcluir?: () => void;
}

class AdaptadorAtrasado implements ClassificadorNsfw {
  readonly id = "nsfw";
  readonly metricas: MetricasAdaptador = {};
  modelo: string | null = null;
  aoStatus?: (mensagem: string) => void;

  constructor(
    readonly chave: string,
    private readonly opcoes: OpcoesAtrasado = {}
  ) {}

  async carregar(): Promise<void> {
    this.metricas.status = "ok";
  }

  async avaliar(
    _entrada: EntradaAdaptador,
    _opcoes?: OpcoesDeteccao
  ): Promise<ResultadoNsfw> {
    this.opcoes.aoIniciar?.();
    if (this.opcoes.atrasoMs) {
      await new Promise((resolve) => setTimeout(resolve, this.opcoes.atrasoMs));
    }
    this.opcoes.aoConcluir?.();
    if (this.opcoes.falharAvaliacao) throw new Error(`${this.chave} falhou`);
    const marcacoes = this.opcoes.resultado?.marcacoes ?? [];
    this.metricas.status = marcacoes.length ? "ok" : "sem_resultado";
    return {
      marcacoes,
      modelo: this.chave,
      resumo: marcacoes.length ? this.chave : "nenhuma marcacao",
    };
  }

  encerrar(): void {}
}

const chaves = ["a", "b", "c", "d", "e", "f"];

describe("paralelismo limitado do conjunto NSFW (Fase 3)", () => {
  it("limita a dois modelos em voo e mantem a ordem dos ids", async () => {
    let emVoo = 0;
    let maximo = 0;
    const conjunto = new AdaptadorNsfwConjunto({
      modelos: chaves,
      limiteConcorrencia: 2,
      criarAdaptador: (modelo) =>
        new AdaptadorAtrasado(modelo, {
          atrasoMs: 5,
          aoIniciar: () => {
            emVoo += 1;
            maximo = Math.max(maximo, emVoo);
          },
          aoConcluir: () => {
            emVoo -= 1;
          },
        }),
    });
    await conjunto.carregar(MODELO_NSFW_CONJUNTO);
    const resultado = await conjunto.avaliar(ENTRADA);

    expect(maximo).toBe(2);
    expect(resultado.modelos).toEqual(chaves);
    expect(conjunto.metricas.limiteConcorrencia).toBe(2);
    expect(conjunto.metricas.concorrenciaMaximaObservada).toBe(2);
  });

  it("com limite 1 executa em serie sem perder resultados", async () => {
    let emVoo = 0;
    let maximo = 0;
    const conjunto = new AdaptadorNsfwConjunto({
      modelos: ["a", "b", "c"],
      limiteConcorrencia: 1,
      criarAdaptador: (modelo) =>
        new AdaptadorAtrasado(modelo, {
          atrasoMs: 1,
          aoIniciar: () => {
            emVoo += 1;
            maximo = Math.max(maximo, emVoo);
          },
          aoConcluir: () => {
            emVoo -= 1;
          },
        }),
    });
    await conjunto.carregar(MODELO_NSFW_CONJUNTO);
    await conjunto.avaliar(ENTRADA);
    expect(maximo).toBe(1);
    expect(conjunto.metricas.concorrenciaMaximaObservada).toBe(1);
  });

  it("uma falha nao bloqueia a fila nem remove os demais modelos", async () => {
    const iniciados: string[] = [];
    const conjunto = new AdaptadorNsfwConjunto({
      modelos: ["a", "b", "c"],
      limiteConcorrencia: 1,
      criarAdaptador: (modelo) =>
        new AdaptadorAtrasado(modelo, {
          falharAvaliacao: modelo === "b",
          aoIniciar: () => iniciados.push(modelo),
        }),
    });
    await conjunto.carregar(MODELO_NSFW_CONJUNTO);
    const resultado = await conjunto.avaliar(ENTRADA);

    expect(iniciados).toEqual(["a", "b", "c"]);
    expect(resultado.modelos).toEqual(["a", "c"]);
    expect(conjunto.metricas.motivoFalha).toContain("b falhou");
  });

  it("expõe grupos com hipoteses conflitantes sem alterar as marcacoes mescladas", async () => {
    const conjunto = new AdaptadorNsfwConjunto({
      modelos: ["a", "b"],
      criarAdaptador: (modelo) =>
        new AdaptadorAtrasado(modelo, {
          resultado: {
            marcacoes: [
              marcacao(
                modelo === "a" ? "MALE_GENITALIA_EXPOSED" : "penis",
                modelo === "a" ? 0.61 : 0.54,
                caixa(10, 10, 100, 100),
                modelo
              ),
            ],
            modelo,
          },
        }),
    });
    await conjunto.carregar(MODELO_NSFW_CONJUNTO);
    const resultado = await conjunto.avaliar(ENTRADA);

    expect(resultado.marcacoes).toHaveLength(2);
    expect(resultado.grupos).toHaveLength(1);
    expect(resultado.grupos?.[0].status).toBe("conflito_semantico");
    expect(resultado.grupos?.[0].hipoteses).toHaveLength(2);
    const marcas: MarcacaoNsfw[] = resultado.grupos![0].hipoteses.map((h) => ({
      rotulo: h.rotulo,
      score: h.score,
      caixa: h.caixaOriginal,
      ...(h.modelo ? { modelo: h.modelo } : {}),
    }));
    expect(marcas.map((m) => m.rotulo)).toEqual(["MALE_GENITALIA_EXPOSED", "penis"]);
  });
});
