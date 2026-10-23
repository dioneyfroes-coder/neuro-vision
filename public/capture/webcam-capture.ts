import { ErroPercepcao } from "../../src/erros";
import { criarFrameId } from "../../src/domain/ids";
import type { SnapshotCapturado } from "./snapshot-store";

/**
 * Superficie minima da camera usada pela captura multiframe. Evita acoplar o
 * modulo a classe concreta `Camera` (facilita o teste com fonte falsa).
 */
export interface FonteCaptura {
  readonly ativa: boolean;
  readonly largura: number;
  readonly altura: number;
  capturarQuadro(
    maxWidth?: number,
    larguraThumb?: number,
    qualidade?: number
  ): { imagem: string; thumb: string } | null;
  assinaturaDeCena(grade?: number): number[] | null;
}

export interface ConfigCaptura {
  /** Quantidade de snapshots por ciclo (padrao: 4). */
  quadros: number;
  /** Intervalo aproximado entre capturas, em ms (padrao: 1000). */
  intervaloMs: number;
  /** Largura maxima da imagem de analise (limita resolucao/memoria). */
  maxLargura: number;
  /** Largura do thumbnail de persistencia. */
  larguraThumb: number;
  /** Qualidade JPEG (0..1), para limitar o payload retido em memoria. */
  qualidadeJpeg: number;
}

export const CONFIG_CAPTURA_PADRAO: ConfigCaptura = {
  quadros: 4,
  /**
   * Espacamento entre snapshots dentro do ciclo. Reduzido de 1000 para 500 ms:
   * com o processamento local ja paralelizado, encurtar a janela de captura
   * diminui o tempo total do ciclo sem perder a ideia de "varios instantes".
   * Ajustavel pela politica do ciclo (`intervaloEntreSnapshotsMs`).
   */
  intervaloMs: 500,
  maxLargura: 640,
  larguraThumb: 240,
  qualidadeJpeg: 0.7,
};

/** Dependencias injetaveis para tornar a captura deterministica nos testes. */
export interface DepsCaptura {
  /** Relogio monotonico (ms). Padrao: `performance.now`. */
  agora?: () => number;
  /** Espera cooperativa. Padrao: `setTimeout`. */
  esperar?: (ms: number) => Promise<void>;
  /** Relogio de parede ISO. Padrao: `new Date().toISOString`. */
  agoraIso?: () => string;
}

function esperaReal(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cancelado(): ErroPercepcao {
  return new ErroPercepcao("cancelamento", "captura cancelada");
}

/**
 * Captura varios snapshots identificados, **sem inferencia** (roteiro 4.1/4.2).
 *
 * Coleta `quadros` frames espacados por `intervaloMs`, cada um com `frameId`,
 * instante ISO e instante monotonico. Nao processa nada aqui: o processamento
 * local acontece depois, sobre os snapshots ja guardados. Cancela de forma
 * cooperativa via `AbortSignal`.
 */
export class WebcamCapture {
  private readonly agora: () => number;
  private readonly esperar: (ms: number) => Promise<void>;
  private readonly agoraIso: () => string;

  constructor(
    private readonly fonte: FonteCaptura,
    private readonly config: ConfigCaptura = CONFIG_CAPTURA_PADRAO,
    deps: DepsCaptura = {}
  ) {
    this.agora = deps.agora ?? (() => performance.now());
    this.esperar = deps.esperar ?? esperaReal;
    this.agoraIso = deps.agoraIso ?? (() => new Date().toISOString());
  }

  /**
   * Captura um ciclo de snapshots. Lanca cancelamento se o sinal for abortado;
   * devolve lista vazia se a camera ainda nao tiver frame.
   */
  async capturar(
    cycleId: string,
    sinal?: AbortSignal
  ): Promise<SnapshotCapturado[]> {
    const snapshots: SnapshotCapturado[] = [];
    for (let i = 0; i < this.config.quadros; i++) {
      if (sinal?.aborted) throw cancelado();

      const capturadoEmMs = this.agora();
      const capturadoEm = this.agoraIso();
      const par = this.fonte.capturarQuadro(
        this.config.maxLargura,
        this.config.larguraThumb,
        this.config.qualidadeJpeg
      );
      if (par === null) break;

      const assinaturaCena = this.fonte.assinaturaDeCena() ?? undefined;
      snapshots.push(
        Object.freeze({
          frameId: criarFrameId(cycleId, i),
          imagem: par.imagem,
          thumb: par.thumb,
          capturadoEm,
          capturadoEmMs,
          dimensoes: { largura: this.fonte.largura, altura: this.fonte.altura },
          assinaturaCena,
        })
      );

      if (i < this.config.quadros - 1) {
        const decorrido = this.agora() - capturadoEmMs;
        const esperaMs = Math.max(0, this.config.intervaloMs - decorrido);
        await this.esperarComAbort(esperaMs, sinal);
      }
    }
    return snapshots;
  }

  private esperarComAbort(ms: number, sinal?: AbortSignal): Promise<void> {
    if (!sinal) return this.esperar(ms);
    if (sinal.aborted) return Promise.reject(cancelado());
    return new Promise<void>((resolve, reject) => {
      const aoAbortar = (): void => reject(cancelado());
      sinal.addEventListener("abort", aoAbortar, { once: true });
      this.esperar(ms).then(
        () => {
          sinal.removeEventListener("abort", aoAbortar);
          resolve();
        },
        (err) => {
          sinal.removeEventListener("abort", aoAbortar);
          reject(err);
        }
      );
    });
  }
}
