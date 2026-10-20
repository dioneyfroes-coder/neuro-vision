import { descreverDeteccoes } from "../../detector";
import { DetectorYoloOnnx, type MotorDeteccao } from "../../yolo-onnx";
import type { MetricasAdaptador, DetectorObjetos, EntradaAdaptador, OpcoesDeteccao } from "../contracts";
import { amostrarMemoriaBytes, medirTempoInferencia } from "../contracts";
import type { ResultadoDeteccaoLocal } from "../../../src/domain/perception";

/**
 * Adaptador do detector de objetos (YOLO em ONNX, `onnxruntime-web`) para a
 * porta `DetectorObjetos` (Etapa 3 do roteiro).
 *
 * Converte a saida crua do SDK em `ResultadoDeteccaoLocal`: rotulos traduzidos,
 * caixas em pixels da imagem analisada, confianca em [0, 1] e dimensoes do
 * frame. Tambem mede carga, inferencia e memoria (Etapa 3.5).
 */
export class AdaptadorDetectorObjetos implements DetectorObjetos {
  readonly id = "objetos";
  private readonly interno: MotorDeteccao;
  private readonly metricasValor: MetricasAdaptador = {};
  private aoStatusValor?: (mensagem: string) => void;

  /**
   * Aceita um motor falsificado nos testes; em producao usa o YOLO ONNX.
   */
  constructor(interno: MotorDeteccao = new DetectorYoloOnnx()) {
    this.interno = interno;
  }

  get modelo(): string | null {
    return this.interno.modelo;
  }

  /**
   * Dispositivo realmente usado na inferencia (sempre `wasm`: o
   * `onnxruntime-web` roda em WASM por decisao de compatibilidade).
   */
  get dispositivo(): "webgpu" | "wasm" | null {
    return this.interno.dispositivo;
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
    await this.interno.carregar(modelo, aoStatus ?? (() => {}));
    this.metricasValor.tempoCargaMs = Math.round(performance.now() - inicio);
    this.metricasValor.memoriaBytes = amostrarMemoriaBytes() ?? this.metricasValor.memoriaBytes;
    this.metricasValor.modelo = this.interno.modelo ?? undefined;
    this.metricasValor.dispositivo = this.interno.dispositivo ?? undefined;
    this.metricasValor.status = "ok";
    this.metricasValor.motivoFalha = undefined;
  }

  detectar(entrada: EntradaAdaptador, opcoes?: OpcoesDeteccao): Promise<ResultadoDeteccaoLocal> {
    return medirTempoInferencia(this.metricasValor, async () => {
      try {
        const cru = await this.interno.executar(entrada.imagem, {
          threshold: opcoes?.threshold ?? 0.5,
          percentage: opcoes?.percentage ?? false,
        });
        const { objetos, resumo } = descreverDeteccoes(cru);
        this.metricasValor.status = objetos.length > 0 ? "ok" : "sem_resultado";
        this.metricasValor.motivoFalha = undefined;
        return {
          deteccoes: objetos,
          dimensoes: entrada.dimensoes,
          modelo: this.interno.modelo ?? undefined,
          resumo,
        };
      } catch (err) {
        const motivo = err instanceof Error ? err.message : String(err);
        this.metricasValor.status = "indisponivel";
        this.metricasValor.motivoFalha = motivo;
        throw err;
      }
    });
  }

  /** Libera a sessao do runtime, quando o motor concretor mantiver recursos. */
  encerrar(): void {
    this.interno.encerrar?.();
    this.metricasValor.status = "nao_carregado";
  }
}
