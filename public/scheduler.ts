/**
 * Agendador de analises encadeado.
 *
 * Em vez de um `setInterval` com periodo fixo, aguarda a conclusao da analise
 * atual e entao calcula o proximo atraso usando o intervalo configurado e a
 * duracao real da ultima inferencia:
 *
 *     espera = max(intervaloConfigurado, ultimaDuracaoMs + margemMs)
 *
 * Isso evita ticks perdidos de um timer fixo quando uma inferencia demora e
 * garante que apenas uma analise esteja em execucao por vez.
 */

export const MARGEM_RESERVA_MS = 500;

export function calcularEspera(
  intervaloMs: number,
  ultimaDuracaoMs: number,
  margemMs = MARGEM_RESERVA_MS
): number {
  return Math.max(intervaloMs, ultimaDuracaoMs + margemMs);
}

export interface DependenciasAgendador {
  /** Executa uma analise. Deve terminar sem rejeitar em falhas ja tratadas. */
  executar: () => Promise<void>;
  /** Leitura do intervalo configurado em cada ciclo. */
  obterIntervaloMs: () => number;
  /** Leitura da duracao da ultima analise em cada ciclo. */
  obterUltimaDuracaoMs: () => number;
}

export class AgendadorAnalise {
  private rodando = false;
  private execucaoAtual: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: DependenciasAgendador) {}

  get estaRodando(): boolean {
    return this.rodando;
  }

  get estaExecutando(): boolean {
    return this.execucaoAtual !== null;
  }

  /**
   * Dispara a analise imediata e arma o primeiro ciclo.
   *
   * Se uma execucao de uma sessao ja parada ainda estiver terminando (uma
   * inferencia que nao pode ser cancelada), espera-a antes de iniciar, para
   * nunca sobrepor duas analises nem deixar de rodar a analise imediata.
   */
  async iniciar(): Promise<void> {
    if (this.rodando) return;
    this.rodando = true;
    if (this.execucaoAtual) {
      await this.execucaoAtual.catch(() => undefined);
    }
    await this.executarUma();
    this.agendar();
  }

  /** Cancela o timer; analises em andamento terminam, mas nenhuma nova comeca. */
  parar(): void {
    this.rodando = false;
    this.limparTimer();
  }

  /**
   * Executa uma analise imediatamente (sem mexer no agendamento pendente).
   * Usado pelo botao "analisar agora": nenhuma analise em andamento e
   * interrompida e uma nova nunca sobrepoe a atual.
   */
  disparar(): void {
    if (!this.rodando) return;
    void this.executarUma();
  }

  /** Reaplica a configuracao ao agendamento pendente (ex.: mudanca de intervalo). */
  reajustar(): void {
    if (!this.rodando) return;
    this.limparTimer();
    this.agendar();
  }

  /** Inicia uma analise se nenhuma estiver em andamento; senao, aguarda a atual. */
  private executarUma(): Promise<void> {
    if (this.execucaoAtual) return this.execucaoAtual;
    const execucao = (async () => {
      try {
        await this.deps.executar();
      } finally {
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
      this.deps.obterUltimaDuracaoMs()
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