import type { ClassificadorNsfw, EntradaAdaptador, MetricasAdaptador, OpcoesDeteccao } from "../../public/perception/contracts";
import { AdaptadorNsfwConjunto } from "../../public/perception/adapters/nsfw-classifier.adapter";
import type { DeteccaoYOLO, MotorDeteccao } from "../../public/yolo-onnx";
import type { MarcacaoNsfw, ResultadoNsfw } from "../../src/domain/perception";

export function caixa(xmin: number, ymin: number, xmax: number, ymax: number): MarcacaoNsfw["caixa"] {
  return { xmin, ymin, xmax, ymax };
}

export function marcacao(
  rotulo: string,
  score: number,
  box: MarcacaoNsfw["caixa"],
  modelo?: string
): MarcacaoNsfw {
  return { rotulo, score, caixa: box, ...(modelo ? { modelo } : {}) };
}

/** Adaptador de modelo unico controlavel para exercitar o conjunto. */
export class AdaptadorFalso implements ClassificadorNsfw {
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
      motivoFallback?: string;
    } = {}
  ) {}

  async carregar(modelo: string): Promise<void> {
    this.metricas.tempoCargaMs = 1;
    this.metricas.dispositivo = "wasm";
    this.metricas.modelo = modelo;
    if (this.opcoes.motivoFallback) {
      this.metricas.motivoFallback = this.opcoes.motivoFallback;
    }
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

export function criarConjunto(
  opcoes: Record<string, ConstructorParameters<typeof AdaptadorFalso>[1]>
): AdaptadorNsfwConjunto {
  const chaves = Object.keys(opcoes);
  return new AdaptadorNsfwConjunto({
    modelos: chaves,
    criarAdaptador: (modelo) => new AdaptadorFalso(modelo, opcoes[modelo]),
  });
}

export const ENTRADA: EntradaAdaptador = { imagem: "data:image/png;base64,AAAA" };

/** Motor de deteccao controlavel para exercitar a telemetria de fallback. */
export class MotorFalso implements MotorDeteccao {
  modelo: string | null = "nudenet_320n";
  dispositivo: "webgpu" | "wasm" | null = "wasm";
  tempoCargaMs: number | null = 3;
  aoStatus?: (mensagem: string) => void;

  constructor(readonly motivoFallback: string | null = null) {}

  async carregar(): Promise<void> {}
  async executar(): Promise<DeteccaoYOLO[]> {
    return [];
  }
  encerrar(): void {}
}
