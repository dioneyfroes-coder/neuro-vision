import { DetectorNsfwOnnx } from "../../../nsfw-onnx";
import type { MotorDeteccao } from "../../../yolo-onnx";
import type {
  MetricasAdaptador,
  ClassificadorNsfw,
  EntradaAdaptador,
  OpcoesDeteccao,
} from "../../contracts";
import { amostrarMemoriaBytes, medirTempoInferencia } from "../../contracts";
import type { MarcacaoNsfw, ResultadoNsfw } from "../../../../src/domain/perception";

export class AdaptadorClassificadorNsfw implements ClassificadorNsfw {
  readonly id = "nsfw";
  private readonly interno: MotorDeteccao;
  private readonly metricasValor: MetricasAdaptador = {};
  private aoStatusValor?: (mensagem: string) => void;

  /** Aceita um motor falsificado nos testes; em producao usa o NSFW ONNX. */
  constructor(interno: MotorDeteccao = new DetectorNsfwOnnx()) {
    this.interno = interno;
  }

  get modelo(): string | null {
    return this.interno.modelo;
  }

  get metricas(): MetricasAdaptador {
    return this.metricasValor;
  }

  get aoStatus(): ((mensagem: string) => void) | undefined {
    return this.aoStatusValor;
  }

  set aoStatus(fn: ((mensagem: string) => void) | undefined) {
    this.aoStatusValor = fn;
    this.interno.aoStatus = fn;
  }

  async carregar(modelo: string, aoStatus?: (mensagem: string) => void): Promise<void> {
    const inicio = performance.now();
    try {
      await this.interno.carregar(modelo, aoStatus ?? (() => {}));
      this.metricasValor.tempoCargaMs = Math.round(performance.now() - inicio);
      this.metricasValor.memoriaBytes = amostrarMemoriaBytes() ?? this.metricasValor.memoriaBytes;
      this.metricasValor.modelo = this.interno.modelo ?? modelo;
      this.metricasValor.dispositivo = this.interno.dispositivo ?? undefined;
      this.metricasValor.status = "ok";
      this.metricasValor.motivoFalha = undefined;
      this.metricasValor.motivoFallback = this.interno.motivoFallback ?? undefined;
    } catch (err) {
      // A falha de carga tambem e telemetria: sem isso o conjunto nao consegue
      // distinguir "modelo nao tentou carregar" de "tentou e falhou".
      this.metricasValor.tempoCargaMs = Math.round(performance.now() - inicio);
      this.metricasValor.modelo = this.interno.modelo ?? modelo;
      this.metricasValor.dispositivo = this.interno.dispositivo ?? undefined;
      this.metricasValor.status = "indisponivel";
      this.metricasValor.motivoFalha = err instanceof Error ? err.message : String(err);
      this.metricasValor.motivoFallback = this.interno.motivoFallback ?? undefined;
      throw err;
    }
  }

  avaliar(entrada: EntradaAdaptador, opcoes?: OpcoesDeteccao): Promise<ResultadoNsfw> {
    return medirTempoInferencia(this.metricasValor, async () => {
      try {
        const cru = await this.interno.executar(entrada.imagem, {
          threshold: opcoes?.threshold ?? 0.5,
          percentage: opcoes?.percentage ?? false,
        });
        const marcacoes: MarcacaoNsfw[] = cru.map((d) => ({
          rotulo: d.label,
          score: Number(d.score.toFixed(3)),
          caixa: d.box,
        }));
        const contagem: Record<string, number> = {};
        for (const m of marcacoes) contagem[m.rotulo] = (contagem[m.rotulo] ?? 0) + 1;
        const resumo = marcacoes.length
          ? Object.entries(contagem)
              .map(([rotulo, n]) => (n > 1 ? `${n}x ${rotulo}` : rotulo))
              .join(", ")
          : "nenhuma marcacao";
        this.metricasValor.status = marcacoes.length > 0 ? "ok" : "sem_resultado";
        this.metricasValor.motivoFalha = undefined;
        this.metricasValor.motivoFallback = this.interno.motivoFallback ?? undefined;
        return {
          marcacoes,
          modelo: this.interno.modelo ?? undefined,
          resumo,
        };
      } catch (err) {
        this.metricasValor.status = "indisponivel";
        this.metricasValor.motivoFalha = err instanceof Error ? err.message : String(err);
        this.metricasValor.motivoFallback = this.interno.motivoFallback ?? undefined;
        throw err;
      }
    });
  }

  /** Libera a sessao do runtime, quando o motor concretor mantiver recursos. */
  encerrar(): void {
    this.interno.encerrar?.();
    this.metricasValor.status = "nao_carregado";
    this.metricasValor.motivoFallback = undefined;
  }
}
