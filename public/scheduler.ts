/**
 * Agendador de analises encadeado.
 *
 * Mede a duração real de todo o ciclo (execução completa) com performance.now()
 * e calcula o atraso até o próximo ciclo respeitando **dois** limites:
 * - o intervalo entre inícios configurado (`intervalo - duracaoCiclo`, contado
 *   do início do ciclo anterior);
 * - a pausa pós-ciclo (`pausaAposCicloMs`, contada do **fim** do ciclo anterior).
 *
 * Como a espera começa sempre após a conclusão, a pausa entra como piso direto:
 * `espera = max(margemMinima, intervalo - duracaoCiclo, pausaAposCiclo)`. Isso
 * garante que um ciclo nunca comece antes do prazo apenas porque o ciclo
 * anterior foi mais longo que o intervalo.
 */
export const MARGEM_RESERVA_MS = 500;

export function calcularEspera(
  intervaloMs: number,
  duracaoCicloMs: number,
  margemMs = MARGEM_RESERVA_MS,
  pausaAposCicloMs = 0
): number {
  return Math.max(margemMs, intervaloMs - duracaoCicloMs, pausaAposCicloMs);
}

export interface DependenciasAgendador {
  /** Executa uma analise. Deve terminar sem rejeitar em falhas ja tratadas. */
  executar: () => Promise<void>;
  /** Leitura do intervalo configurado em cada ciclo. */
  obterIntervaloMs: () => number;
  /**
   * Leitura da pausa pós-ciclo (ms), contada do fim efetivo do ciclo anterior.
   * Quando ausente, equivale a 0 (só se aplica o intervalo entre inícios).
   */
  obterPausaAposCicloMs?: () => number;
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
      this.ultimaDuracaoCicloMs,
      MARGEM_RESERVA_MS,
      this.deps.obterPausaAposCicloMs?.() ?? 0
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
