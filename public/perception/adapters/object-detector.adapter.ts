import { DetectorTransformers, descreverDeteccoes } from "../../detector";
import type { MetricasAdaptador, DetectorObjetos, EntradaAdaptador, OpcoesDeteccao } from "../contracts";
import { amostrarMemoriaBytes, medirTempoInferencia } from "../contracts";
import type { ResultadoDeteccaoLocal } from "../../../src/domain/perception";

/**
 * Adaptador do detector de objetos instalado (Transformers.js) para a porta
 * `DetectorObjetos` (Etapa 3 do roteiro).
 *
 * Converte a saida crua do SDK em `ResultadoDeteccaoLocal`: rotulos traduzidos,
 * caixas em pixels da imagem analisada, confianca em [0, 1] e dimensoes do
 * frame. Tambem mede carga, inferencia e memoria (Etapa 3.5).
 */
export class AdaptadorDetectorObjetos implements DetectorObjetos {
  readonly id = "objetos";
  private readonly interno = new DetectorTransformers();
  private readonly metricasValor: MetricasAdaptador = {};
  private aoStatusValor?: (mensagem: string) => void;

  get modelo(): string | null {
    return this.interno.modelo;
  }

  /**
   * Dispositivo realmente usado na ultima carga (`webgpu` ou fallback `wasm`).
   * Especifico do Transformers.js — a aplicacao le isto apenas no diagnostico.
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
  }

  detectar(entrada: EntradaAdaptador, opcoes?: OpcoesDeteccao): Promise<ResultadoDeteccaoLocal> {
    return medirTempoInferencia(this.metricasValor, async () => {
      const cru = await this.interno.executar(entrada.imagem, {
        threshold: opcoes?.threshold ?? 0.5,
        percentage: opcoes?.percentage ?? false,
      });
      const { objetos, resumo } = descreverDeteccoes(cru);
      return {
        deteccoes: objetos,
        dimensoes: entrada.dimensoes,
        modelo: this.interno.modelo ?? undefined,
        resumo,
      };
    });
  }

  encerrar(): void {
    // O detector permanece em cache para reutilizacao entre sessoes.
  }
}
