import { ehCancelamento } from "../../../src/erros";
import { indisponivel } from "../../../src/domain/perception";
import type {
  ClassificacaoGesto,
  LandmarkMao,
  MaoDetectada,
  ResultadoMaos,
  ResultadoOuIndisponivel,
} from "../../../src/domain/perception";
import type { EntradaAdaptador, MetricasAdaptador, ReconhecedorGestos } from "../contracts";
import { amostrarMemoriaBytes, medirTempoInferencia } from "../contracts";

/**
 * Adaptador do reconhecedor de maos/gestos (Etapa 5 do roteiro) atras da porta
 * `ReconhecedorGestos`.
 *
 * O SDK concreto (MediaPipe Gesture Recognizer, ver `public/gestos.ts`) entra por
 * injecao como um `MotorMaos`. O adaptador so conhece a **saida crua**: um
 * landmark por ponto de mao (ja normalizado em [0, 1] pelo MediaPipe), o rotulo
 * cru de lateralidade (`Left`/`Right`) e as categorias cruas de gesto
 * (`Thumb_Up`, `Open_Palm`, ...).
 *
 * As conversoes para o contrato de dominio — lateralidade em portugues, gesto
 * com nome normalizado e confianca limitada a [0, 1] — sao funcoes puras,
 * testaveis sem carregar modelo algum. Falha vira `ResultadoIndisponivel`.
 */

/** Landmark cru de mao (coordenadas normalizadas [0, 1] do MediaPipe). */
export interface LandmarkMaoCru {
  x: number;
  y: number;
  z?: number;
}

/** Uma mao crua entregue pelo motor. */
export interface MaoCru {
  landmarks: LandmarkMaoCru[];
  /** Rotulo cru de lateralidade do SDK (ex.: `Left`, `Right`). */
  lateralidade?: string;
  /** Categorias cruas de gesto, tipicamente ordenadas por confianca desc. */
  gestos?: { nome: string; confianca: number }[];
}

/** Saida crua de uma inferencia de maos. */
export interface SaidaMaosCru {
  maos: MaoCru[];
}

/** Motor de maos ja carregado (especifico do SDK; injetado). */
export interface MotorMaos {
  /** Roda a inferencia sobre a imagem (data URL/base64) e devolve a saida crua. */
  executar(imagem: string): Promise<SaidaMaosCru>;
  /** Versao do runtime/modelo, quando o SDK a expoe. */
  versao?: string;
  /** Dispositivo usado na inferencia (ex.: `gpu`, `cpu`). */
  dispositivo?: string;
  /** Libera recursos do motor. Opcional. */
  encerrar?(): void;
}

/** Fabrica do motor de maos; recebe o caminho/id do modelo. */
export type CriadorMotorMaos = (
  modelo: string,
  aoStatus?: (mensagem: string) => void
) => Promise<MotorMaos>;

/** Gesto cru do MediaPipe -> nome normalizado em portugues. */
const GESTOS_MEDIAPIPE: Record<string, string> = {
  None: "nenhum",
  Closed_Fist: "punho_fechado",
  Open_Palm: "mao_aberta",
  Pointing_Up: "apontando_para_cima",
  Thumb_Down: "polegar_para_baixo",
  Thumb_Up: "polegar_para_cima",
  Victory: "vitoria",
  ILoveYou: "amo_voce",
};

function limite01(valor: number): number {
  if (!Number.isFinite(valor)) return 0;
  return Math.min(1, Math.max(0, valor));
}

/** Normaliza o rotulo cru de lateralidade para o dominio. */
export function mapearLateralidade(rotulo?: string): MaoDetectada["lateralidade"] {
  const limpo = (rotulo ?? "").trim().toLowerCase();
  if (limpo === "left") return "esquerda";
  if (limpo === "right") return "direita";
  return "desconhecida";
}

/** Normaliza o nome cru do gesto (conhecidos em portugues; desconhecidos em snake_case). */
export function mapearGesto(nome: string): string {
  const conhecido = GESTOS_MEDIAPIPE[nome];
  if (conhecido) return conhecido;
  return nome
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Converte a saida crua do motor em `ResultadoMaos` normalizado. */
export function normalizarMaos(saida: SaidaMaosCru): ResultadoMaos {
  const maos: MaoDetectada[] = saida.maos.map((mao) => {
    const landmarks: LandmarkMao[] = mao.landmarks.map((landmark) => {
      const ponto: LandmarkMao = { x: limite01(landmark.x), y: limite01(landmark.y) };
      if (landmark.z !== undefined) ponto.z = landmark.z;
      return ponto;
    });

    const detectada: MaoDetectada = {
      lateralidade: mapearLateralidade(mao.lateralidade),
      landmarks,
    };

    const melhor = mao.gestos?.[0];
    if (melhor && melhor.nome !== "None") {
      const gesto: ClassificacaoGesto = {
        nome: mapearGesto(melhor.nome),
        confianca: limite01(melhor.confianca),
      };
      detectada.gesto = gesto;
    }
    return detectada;
  });

  return { maos };
}

export class AdaptadorMaos implements ReconhecedorGestos {
  readonly id = "maos";
  readonly metricas: MetricasAdaptador = { status: "nao_carregado" };
  aoStatus?: (mensagem: string) => void;

  private motor: MotorMaos | null = null;
  private modeloAtual: string | null = null;

  constructor(private readonly criarMotor: CriadorMotorMaos) {}

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

  reconhecer(entrada: EntradaAdaptador): Promise<ResultadoOuIndisponivel<ResultadoMaos>> {
    const motor = this.motor;
    if (!motor) {
      return Promise.resolve(indisponivel("maos", "reconhecedor de maos nao carregado"));
    }
    return medirTempoInferencia(this.metricas, async () => {
      try {
        const saida = await motor.executar(entrada.imagem);
        const resultado = normalizarMaos(saida);
        this.metricas.status = resultado.maos.length > 0 ? "ok" : "sem_resultado";
        this.metricas.motivoFalha = undefined;
        return resultado;
      } catch (err) {
        if (ehCancelamento(err)) throw err;
        const motivo = err instanceof Error ? err.message : String(err);
        this.metricas.status = "indisponivel";
        this.metricas.motivoFalha = motivo;
        return indisponivel("maos", motivo);
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

  private trocarMotor(novo: MotorMaos, modelo: string): void {
    if (this.motor && this.motor !== novo) this.motor.encerrar?.();
    this.motor = novo;
    this.modeloAtual = modelo;
    this.metricas.dispositivo = novo.dispositivo;
    this.metricas.versao = novo.versao;
  }
}
