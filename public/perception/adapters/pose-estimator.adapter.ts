import { ehCancelamento } from "../../../src/erros";
import { indisponivel } from "../../../src/domain/perception";
import type {
  PessoaPose,
  PontoCorporal,
  ResultadoOuIndisponivel,
  ResultadoPose,
} from "../../../src/domain/perception";
import type { Dimensoes, EntradaAdaptador, EstimadorPose, MetricasAdaptador } from "../contracts";
import { amostrarMemoriaBytes, medirTempoInferencia } from "../contracts";

/**
 * Adaptador do estimador de pose (Etapa 5 do roteiro) atras da porta
 * `EstimadorPose`.
 *
 * O SDK concreto (YOLO Pose via Transformers.js, ver `public/pose.ts`) entra por
 * injecao na forma de um `MotorPose`: o adaptador so conhece a **saida crua**
 * normalizada em keypoints com confianca e as dimensoes do espaco de referencia.
 * A conversao para o contrato de dominio — pontos em [0, 1] — e a funcao pura
 * `normalizarPoses`, testavel sem carregar modelo algum.
 *
 * Falha de inferencia vira `ResultadoIndisponivel` (nunca lista vazia), para que
 * o pipeline local preserve o resultado dos demais subsistemas.
 */

/** Ponto-chave cru do motor de pose, em pixels do espaco de referencia. */
export interface PontoPoseCru {
  x: number;
  y: number;
  /** Visibilidade/confianca do ponto em [0, 1], quando o modelo a expoe. */
  confianca?: number;
}

/** Pessoa crua do motor de pose. */
export interface PessoaPoseCru {
  keypoints: PontoPoseCru[];
  /** Confianca agregada da pessoa em [0, 1], quando disponivel. */
  confianca?: number;
}

/** Saida crua de uma inferencia de pose, com o espaco em que foi medida. */
export interface SaidaPoseCru {
  pessoas: PessoaPoseCru[];
  /** Dimensoes (pixels) da imagem em que os keypoints foram medidos. */
  dimensoes: Dimensoes;
}

/** Motor de pose ja carregado (especifico do SDK; injetado). */
export interface MotorPose {
  /** Roda a inferencia sobre a imagem (data URL/base64) e devolve a saida crua. */
  executar(imagem: string): Promise<SaidaPoseCru>;
  /** Versao do runtime/modelo, quando o SDK a expoe. */
  versao?: string;
  /** Dispositivo usado na inferencia (ex.: `wasm`). */
  dispositivo?: string;
  /** Libera recursos do motor. Opcional: nem todo SDK mantem recursos retidos. */
  encerrar?(): void;
}

/** Fabrica do motor de pose; recebe o id do modelo e devolve o motor carregado. */
export type CriadorMotorPose = (
  modelo: string,
  aoStatus?: (mensagem: string) => void
) => Promise<MotorPose>;

function limite01(valor: number): number {
  if (!Number.isFinite(valor)) return 0;
  return Math.min(1, Math.max(0, valor));
}

/** Converte a saida crua do motor em `ResultadoPose`, com pontos em [0, 1]. */
export function normalizarPoses(saida: SaidaPoseCru): ResultadoPose {
  const largura = saida.dimensoes.largura > 0 ? saida.dimensoes.largura : 1;
  const altura = saida.dimensoes.altura > 0 ? saida.dimensoes.altura : 1;

  const pessoas: PessoaPose[] = saida.pessoas.map((pessoa) => {
    const pontos: PontoCorporal[] = pessoa.keypoints.map((ponto) => {
      const corporal: PontoCorporal = {
        x: limite01(ponto.x / largura),
        y: limite01(ponto.y / altura),
      };
      if (ponto.confianca !== undefined) corporal.confianca = limite01(ponto.confianca);
      return corporal;
    });
    const resultado: PessoaPose = { pontos };
    if (pessoa.confianca !== undefined) resultado.confianca = limite01(pessoa.confianca);
    return resultado;
  });

  return { pessoas };
}

export class AdaptadorPose implements EstimadorPose {
  readonly id = "pose";
  readonly metricas: MetricasAdaptador = { status: "nao_carregado" };
  aoStatus?: (mensagem: string) => void;

  private motor: MotorPose | null = null;
  private modeloAtual: string | null = null;

  constructor(private readonly criarMotor: CriadorMotorPose) {}

  get modelo(): string | null {
    return this.modeloAtual;
  }

  get dispositivo(): string | undefined {
    return this.metricas.dispositivo;
  }

  /**
   * Carrega o motor de forma **idempotente**: repetir a chamada com o mesmo
   * modelo nao recria o motor (evita retencao de recursos GPU/WASM ao reiniciar
   * sessoes). Um modelo diferente substitui o anterior, encerrando-o antes.
   */
  async carregar(modelo: string, aoStatus?: (mensagem: string) => void): Promise<void> {
    const alvo = modelo.trim();
    if (this.motor && this.modeloAtual === alvo) return;
    const inicio = performance.now();
    const novoMotor = await this.criarMotor(alvo, aoStatus ?? this.aoStatus);
    this.trocarMotor(novoMotor, alvo);
    this.metricas.tempoCargaMs = Math.round(performance.now() - inicio);
    this.metricas.memoriaBytes = amostrarMemoriaBytes() ?? this.metricas.memoriaBytes;
    this.metricas.modelo = alvo;
    this.metricas.status = "ok";
    this.metricas.motivoFalha = undefined;
  }

  estimar(entrada: EntradaAdaptador): Promise<ResultadoOuIndisponivel<ResultadoPose>> {
    const motor = this.motor;
    if (!motor) {
      return Promise.resolve(indisponivel("pose", "estimador de pose nao carregado"));
    }
    return medirTempoInferencia(this.metricas, async () => {
      try {
        const saida = await motor.executar(entrada.imagem);
        const resultado = normalizarPoses(saida);
        this.metricas.status = resultado.pessoas.length > 0 ? "ok" : "sem_resultado";
        this.metricas.motivoFalha = undefined;
        return resultado;
      } catch (err) {
        if (ehCancelamento(err)) throw err;
        const motivo = err instanceof Error ? err.message : String(err);
        this.metricas.status = "indisponivel";
        this.metricas.motivoFalha = motivo;
        return indisponivel("pose", motivo);
      }
    });
  }

  /** Libera o motor e volta ao estado "nao carregado". */
  encerrar(): void {
    this.motor?.encerrar?.();
    this.motor = null;
    this.modeloAtual = null;
    this.metricas.status = "nao_carregado";
  }

  private trocarMotor(novo: MotorPose, modelo: string): void {
    if (this.motor && this.motor !== novo) this.motor.encerrar?.();
    this.motor = novo;
    this.modeloAtual = modelo;
    this.metricas.dispositivo = novo.dispositivo;
    this.metricas.versao = novo.versao;
  }
}
