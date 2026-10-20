import { DetectorNsfwOnnx } from "../../nsfw-onnx";
import type { MotorDeteccao } from "../../yolo-onnx";
import type { MetricasAdaptador, ClassificadorNsfw, EntradaAdaptador, OpcoesDeteccao } from "../contracts";
import { amostrarMemoriaBytes, medirTempoInferencia } from "../contracts";
import type { MarcacaoNsfw, ResultadoNsfw } from "../../../src/domain/perception";

/**
 * Adaptador do classificador **NSFW experimental** (YOLO treinado para conteudo
 * sensivel, em ONNX) para a porta `ClassificadorNsfw`.
 *
 * Reaproveita o contrato interno `MotorDeteccao` do YOLO COCO — a saida tem o
 * mesmo formato — e converte em `ResultadoNsfw`: rotulos do proprio modelo,
 * caixas em pixels e confianca em [0, 1]. Falha de carga/inferencia propaga como
 * `ErroPercepcao` (o pipeline a converte em `indisponivel`, isolando o frame).
 */
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
    await this.interno.carregar(modelo, aoStatus ?? (() => {}));
    this.metricasValor.tempoCargaMs = Math.round(performance.now() - inicio);
    this.metricasValor.memoriaBytes = amostrarMemoriaBytes() ?? this.metricasValor.memoriaBytes;
  }

  avaliar(entrada: EntradaAdaptador, opcoes?: OpcoesDeteccao): Promise<ResultadoNsfw> {
    return medirTempoInferencia(this.metricasValor, async () => {
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
      return {
        marcacoes,
        modelo: this.interno.modelo ?? undefined,
        resumo,
      };
    });
  }

  encerrar(): void {
    // O classificador permanece em cache para reutilizacao entre sessoes.
  }
}
