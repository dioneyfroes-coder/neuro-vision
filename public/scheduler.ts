/**
 * Agendador de analises encadeado.
 *
 * Mede a duração real de todo o ciclo (execução completa) com performance.now()
 * e calcula o atraso para que o próximo ciclo comece respeitando o intervalo
 * entre inícios configurado: espera = max(margemMinima, intervalo - duracaoCiclo).
 */
export const MARGEM_RESERVA_MS = 500;

export function calcularEspera(
  intervaloMs: number,
  duracaoCicloMs: number,
  margemMs = MARGEM_RESERVA_MS
): number {
  return Math.max(margemMs, intervaloMs - duracaoCicloMs);
}

export interface DependenciasAgendador {
  /** Executa uma analise. Deve terminar sem rejeitar em falhas ja tratadas. */
  executar: () => Promise<void>;
  /** Leitura do intervalo configurado em cada ciclo. */
  obterIntervaloMs: () => number;
}

export class AgendadorAnalise {
  private rodando = false;
  private execucaoAtual: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ultimaDuracaoCicloMs = 0;

  constructor(private readonly deps: DependenciasAgendador) {}

  get estaRodando(): boolean {
    return this.rodando;
  }

  get estaExecutando(): boolean {
    return this.execucaoAtual !== null;
  }

  async iniciar(): Promise<void> {
    if (this.rodando) return;
    this.rodando = true;
    if (this.execucaoAtual) {
      await this.execucaoAtual.catch(() => undefined);
    }
    await this.executarUma();
    this.agendar();
  }

  parar(): void {
    this.rodando = false;
    this.limparTimer();
  }

  disparar(): void {
    if (!this.rodando) return;
    void this.executarUma();
  }

  reajustar(): void {
    if (!this.rodando) return;
    this.limparTimer();
    this.agendar();
  }

  private executarUma(): Promise<void> {
    if (this.execucaoAtual) return this.execucaoAtual;
    const inicio = performance.now();
    const execucao = (async () => {
      try {
        await this.deps.executar();
      } finally {
        this.ultimaDuracaoCicloMs = Math.round(performance.now() - inicio);
        this.execucaoAtual = null;
      }
    })();
    this.execucaoAtual = execucao;
    return execucao;
  }

  private agendar(): void {
    this.limparTimer();
    if (!this.rodando) return;
    const espera = calcularEspera(
      this.deps.obterIntervaloMs(),
      this.ultimaDuracaoCicloMs
    );
    this.timer = setTimeout(() => void this.ciclo(), espera);
  }

  private limparTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async ciclo(): Promise<void> {
    this.timer = null;
    if (!this.rodando) return;
    await this.executarUma();
    this.agendar();
  }
}
