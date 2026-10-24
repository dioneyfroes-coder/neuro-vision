import type { CorpoRequisicao, MotorWorker, RespostaWorker } from "./protocolo";

/**
 * Cliente RPC da thread principal para um worker dedicado de percepcao.
 *
 * - Uma requisicao por vez e identificada por `id`; respostas fora de ordem sao
 *   correlacionadas pelo mapa de pendentes (os workers serializam por dentro,
 *   mas a interface nao depende disso).
 * - Falha de carregamento do proprio script, `error` nao tratado ou timeout
 *   derrubam o worker e rejeitam todas as requisicoes pendentes com
 *   `ErroWorker`. Os motores remotos usam esse sinal para cair no motor local.
 */

/** Erro de infraestrutura do worker (nao e erro de modelo/inferencia). */
export class ErroWorker extends Error {
  constructor(readonly worker: string, mensagem: string) {
    super(`worker ${worker}: ${mensagem}`);
    this.name = "ErroWorker";
  }
}

/** Tempo maximo para carregar um modelo dentro do worker (rede + inicializacao). */
export const TEMPO_CARGA_WORKER_MS = 180_000;
/** Tempo maximo de uma inferencia no worker. */
export const TEMPO_INFERENCIA_WORKER_MS = 120_000;

interface Pendente {
  resolver(valor: unknown): void;
  rejeitar(erro: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Arquivo de cada motor. Caminhos relativos a `app.js` (raiz de `public/`); os
 * bundles sao gerados por `npm run build:workers`.
 */
export const ARQUIVOS_WORKER: Record<MotorWorker, string> = {
  deteccao: "./workers/worker-onnx.js",
  nsfw: "./workers/worker-onnx.js",
  pose: "./workers/worker-pose.js",
  maos: "./workers/worker-maos.js",
};

export class ClienteWorker {
  private readonly pendentes = new Map<number, Pendente>();
  private proximoId = 1;
  private erroFatal: ErroWorker | null = null;
  private encerrado = false;

  /** Avisos de progresso do motor (carga, fallback de dispositivo). */
  aoStatus?: (mensagem: string) => void;

  constructor(
    readonly motor: MotorWorker,
    arquivo: string = ARQUIVOS_WORKER[motor]
  ) {
    // `import.meta.url` aponta para `/app.js` no bundle final; o caminho
    // relativo resolve para `/workers/*.js` (servido como estatico).
    this.worker = new Worker(new URL(arquivo, import.meta.url), {
      type: "module",
      name: `neuro-${motor}`,
    });
    this.worker.onmessage = (evento: MessageEvent<RespostaWorker>) => this.receber(evento.data);
    this.worker.onerror = (evento) => {
      this.abortar(new ErroWorker(motor, evento.message || "erro nao tratado no worker"));
    };
    this.worker.onmessageerror = () => {
      this.abortar(new ErroWorker(motor, "mensagem invalida recebida do worker"));
    };
  }

  private readonly worker: Worker;

  /** `true` enquanto o worker pode receber requisicoes. */
  get ativo(): boolean {
    return !this.encerrado && this.erroFatal === null;
  }

  /**
   * Envia uma requisicao e aguarda a resposta. Rejeita com `ErroWorker` em
   * falha de infraestrutura, timeout ou encerramento.
   */
  requisitar<T>(
    corpo: CorpoRequisicao,
    tempoLimiteMs: number = TEMPO_INFERENCIA_WORKER_MS
  ): Promise<T> {
    if (this.erroFatal) return Promise.reject(this.erroFatal);
    if (this.encerrado) return Promise.reject(new ErroWorker(this.motor, "cliente encerrado"));
    const id = this.proximoId++;
    const requisicao = { ...corpo, id } as CorpoRequisicao & { id: number };
    return new Promise<T>((resolver, rejeitar) => {
      const timer = setTimeout(() => {
        this.pendentes.delete(id);
        const erro = new ErroWorker(
          this.motor,
          `requisicao ${corpo.tipo} excedeu ${tempoLimiteMs} ms`
        );
        // Um worker travado nao se recupera: derruba para o fallback local.
        this.abortar(erro);
      }, tempoLimiteMs);
      this.pendentes.set(id, {
        resolver: (valor) => resolver(valor as T),
        rejeitar,
        timer,
      });
      try {
        this.worker.postMessage(requisicao);
      } catch (erro) {
        clearTimeout(timer);
        this.pendentes.delete(id);
        rejeitar(new ErroWorker(this.motor, String(erro)));
      }
    });
  }

  /** Encerra o worker e rejeita o que estiver pendente. */
  encerrar(): void {
    if (this.encerrado) return;
    this.encerrado = true;
    this.worker.terminate();
    this.rejeitarPendentes(new ErroWorker(this.motor, "worker encerrado"));
  }

  private receber(resposta: RespostaWorker): void {
    if ("tipo" in resposta) {
      if (resposta.tipo === "status") this.aoStatus?.(resposta.mensagem);
      return;
    }
    const pendente = this.pendentes.get(resposta.id);
    if (!pendente) return;
    this.pendentes.delete(resposta.id);
    clearTimeout(pendente.timer);
    if (resposta.ok) {
      pendente.resolver(resposta.valor);
    } else {
      // Erro devolvido pelo motor e de inferencia/carga, nao de infraestrutura:
      // o wrapper ainda pode tentar o motor local como fallback.
      pendente.rejeitar(new Error(resposta.erro));
    }
  }

  private abortar(erro: ErroWorker): void {
    if (this.erroFatal) return;
    this.erroFatal = erro;
    this.worker.terminate();
    this.rejeitarPendentes(erro);
  }

  private rejeitarPendentes(erro: Error): void {
    for (const pendente of this.pendentes.values()) {
      clearTimeout(pendente.timer);
      pendente.rejeitar(erro);
    }
    this.pendentes.clear();
  }
}
