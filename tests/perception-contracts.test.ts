import { afterEach, describe, expect, it, vi } from "vitest";
import { AdaptadorDetectorObjetos } from "../public/perception/adapters/object-detector.adapter";
import type { EstimadorPose, ReconhecedorGestos, MetricasAdaptador } from "../public/perception/contracts";
import { amostrarMemoriaBytes, medirTempoInferencia } from "../public/perception/contracts";
import { estaIndisponivel, indisponivel } from "../src/domain";
import type { ResultadoMaos, ResultadoOuIndisponivel, ResultadoPose } from "../src/domain";
import { chamadas } from "../src/transformers.stub";
import type { DeteccaoYOLO, MotorDeteccao } from "../public/yolo-onnx";

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Testes de contrato das portas de percepcao (Etapa 3). Verificam que qualquer
 * adaptador entrega evidencia normalizada — coordenadas/dimensoes/confianca — e
 * que falha vira `ResultadoIndisponivel`, nunca lista vazia (principio 8).
 */
describe("AdaptadorDetectorObjetos", () => {
  /** Motor de deteccao falso: devolve as deteccoes crus sem tocar em rede. */
  function motorFalso(deteccoes: DeteccaoYOLO[]): MotorDeteccao {
    let modelo: string | null = null;
    return {
      get modelo() {
        return modelo;
      },
      dispositivo: "wasm",
      tempoCargaMs: 7,
      async carregar(chave: string | null) {
        modelo = chave;
      },
      async executar() {
        return deteccoes;
      },
    };
  }

  it("normaliza a saida do motor em ResultadoDeteccaoLocal", async () => {
    const cru: DeteccaoYOLO[] = [
      { label: "person", score: 0.9876, box: { xmin: 1, ymin: 2, xmax: 30, ymax: 40 } },
      { label: "dog", score: 0.4, box: { xmin: 5, ymin: 6, xmax: 35, ymax: 46 } },
    ];
    const adaptador = new AdaptadorDetectorObjetos(motorFalso(cru));
    await adaptador.carregar("modelo-a");

    const resultado = await adaptador.detectar(
      { imagem: "data:image/png;base64,AAAA", dimensoes: { largura: 640, altura: 480 } },
      { threshold: 0.5 }
    );

    expect(resultado.dimensoes).toEqual({ largura: 640, altura: 480 });
    expect(resultado.modelo).toBe("modelo-a");
    expect(resultado.resumo).toBe("pessoa, cachorro");
    expect(resultado.deteccoes[0]).toEqual({
      nome: "pessoa",
      rotulo: "person",
      score: 0.988,
      caixa: { xmin: 1, ymin: 2, xmax: 30, ymax: 40 },
    });
    // Confianca normalizada em [0, 1].
    for (const d of resultado.deteccoes) {
      expect(d.score).toBeGreaterThanOrEqual(0);
      expect(d.score).toBeLessThanOrEqual(1);
    }
  });

  it("mede carga, inferencia e memoria por adaptador", async () => {
    const cru: DeteccaoYOLO[] = [
      { label: "car", score: 0.9, box: { xmin: 0, ymin: 0, xmax: 1, ymax: 1 } },
    ];
    const adaptador = new AdaptadorDetectorObjetos(motorFalso(cru));
    await adaptador.carregar("modelo-b");
    await adaptador.detectar({ imagem: "x" });

    expect(adaptador.metricas.tempoCargaMs).toBeTypeOf("number");
    expect(adaptador.metricas.tempoInferenciaMs).toBeTypeOf("number");
  });

  it("roda em WASM por decisao de compatibilidade (sem WebGPU)", async () => {
    const adaptador = new AdaptadorDetectorObjetos(motorFalso([]));
    await adaptador.carregar("onnx-community/yolov10n");
    expect(adaptador.dispositivo).toBe("wasm");
    // A deteccao nao passa mais pelo transformers.js: o stub fica vazio.
    expect(chamadas).toEqual([]);
  });
});

/** Implementacao de referencia do adaptador de pose, usada so nos testes. */
class EstimadorPoseFalso implements EstimadorPose {
  readonly id = "pose-falso";
  readonly modelo: string | null = "pose-teste";
  readonly metricas: MetricasAdaptador = {};
  aoStatus?: (mensagem: string) => void;
  private falhar = false;

  carregar(): Promise<void> {
    return Promise.resolve();
  }

  definirFalha(falhar: boolean): void {
    this.falhar = falhar;
  }

  estimar(): Promise<ResultadoOuIndisponivel<ResultadoPose>> {
    return medirTempoInferencia(this.metricas, async () => {
      if (this.falhar) return indisponivel("pose", "estimador falhou");
      return {
        pessoas: [
          { pontos: [{ x: 0.5, y: 0.25, confianca: 0.9 }], confianca: 0.9 },
        ],
        modelo: "pose-teste",
      };
    });
  }

  encerrar(): void {
    // nada a liberar
  }
}

/** Implementacao de referencia do adaptador de maos/gestos, usada so nos testes. */
class ReconhecedorGestosFalso implements ReconhecedorGestos {
  readonly id = "gestos-falso";
  readonly modelo: string | null = "gestos-teste";
  readonly metricas: MetricasAdaptador = {};
  aoStatus?: (mensagem: string) => void;

  carregar(): Promise<void> {
    return Promise.resolve();
  }

  reconhecer(): Promise<ResultadoOuIndisponivel<ResultadoMaos>> {
    return medirTempoInferencia(this.metricas, async () => ({
      maos: [
        {
          lateralidade: "direita",
          landmarks: [{ x: 0.1, y: 0.2, z: 0.0 }],
          gesto: { nome: "polegar_para_cima", confianca: 0.8 },
        },
      ],
      modelo: "gestos-teste",
    }));
  }

  encerrar(): void {
    // nada a liberar
  }
}

describe("contrato de EstimadorPose", () => {
  it("entrega pontos normalizados e confianca em [0, 1]", async () => {
    const estimador = new EstimadorPoseFalso();
    const resultado = await estimador.estimar({ imagem: "x" });
    expect(estaIndisponivel(resultado)).toBe(false);
    if (estaIndisponivel(resultado)) throw new Error("nao esperado");
    for (const pessoa of resultado.pessoas) {
      for (const ponto of pessoa.pontos) {
        expect(ponto.x).toBeGreaterThanOrEqual(0);
        expect(ponto.x).toBeLessThanOrEqual(1);
        expect(ponto.y).toBeGreaterThanOrEqual(0);
        expect(ponto.y).toBeLessThanOrEqual(1);
      }
    }
  });

  it("falha vira ResultadoIndisponivel, nunca lista vazia", async () => {
    const estimador = new EstimadorPoseFalso();
    estimador.definirFalha(true);
    const resultado = await estimador.estimar({ imagem: "x" });
    expect(estaIndisponivel(resultado)).toBe(true);
    expect(estimador.metricas.tempoInferenciaMs).toBeTypeOf("number");
  });
});

describe("contrato de ReconhecedorGestos", () => {
  it("entrega landmarks normalizados e classificacao com confianca", async () => {
    const reconhecedor = new ReconhecedorGestosFalso();
    const resultado = await reconhecedor.reconhecer({ imagem: "x" });
    expect(estaIndisponivel(resultado)).toBe(false);
    if (estaIndisponivel(resultado)) throw new Error("nao esperado");
    const mao = resultado.maos[0];
    expect(mao.lateralidade).toBe("direita");
    expect(mao.landmarks[0].x).toBeGreaterThanOrEqual(0);
    expect(mao.landmarks[0].x).toBeLessThanOrEqual(1);
    expect(mao.gesto?.confianca).toBeGreaterThanOrEqual(0);
    expect(mao.gesto?.confianca).toBeLessThanOrEqual(1);
  });
});

describe("metricas compartilhadas", () => {
  it("medirTempoInferencia mede mesmo quando a inferencia falha", async () => {
    const metricas: MetricasAdaptador = {};
    await expect(
      medirTempoInferencia(metricas, async () => {
        throw new Error("falha");
      })
    ).rejects.toThrow("falha");
    expect(metricas.tempoInferenciaMs).toBeTypeOf("number");
  });

  it("amostrarMemoriaBytes e opcional (undefined fora do Chrome)", () => {
    const amostra = amostrarMemoriaBytes();
    expect(amostra === undefined || typeof amostra === "number").toBe(true);
  });
});
