/**
 * Fila de persistencia do cliente (Fase 6C).
 *
 * As gravacoes do historico e dos eventos sao disparadas em sequencia pela
 * interface. Antes, cada `gravar*` corria em paralelo (`void api.gravar...`),
 * sem ordem garantida nem retentativa, e uma falha de rede/HTTP se perdia. Esta
 * fila:
 *
 * - mantem a ordem de chegada e limita a **uma** requisicao simultanea;
 * - tenta de novo algumas vezes com atraso progressivo em falhas transitorias;
 * - nao repete indefinidamente nem bloqueia o processamento visual (a interface
 *   segue agendando; a fila drena em segundo plano);
 * - guarda os itens que falharam de vez para exportacao;
 * - permite pausar/limpar para que a limpeza de historico nao sofra corrida com
 *   gravacoes pendentes (Fase 5).
 */

export interface TarefaPersistencia {
  /** Rotulo curto para o diagnostico (ex.: `evento:aparicao`). */
  descricao: string;
  /** Conteudo original, exportado quando a gravacao falha de vez. */
  payload: unknown;
  /** Executa a gravacao; deve rejeitar quando o servidor nao grave. */
  executar: () => Promise<void>;
  /** Aviso opcional de falha definitiva (apos esgotar as tentativas). */
  aoFalhar?: () => void;
}

export interface EstadoFila {
  /** Itens gravados com sucesso. */
  enviados: number;
  /** Itens descartados apos esgotar as tentativas (ou por fila cheia). */
  falhas: number;
  /** Itens aguardando gravacao. */
  pendentes: number;
  /** Mensagem da ultima falha. */
  ultimoErro?: string;
}

export interface OpcoesFila {
  /** Tentativas por item (>= 1). Padrao: 3. */
  maxTentativas?: number;
  /** Atraso da primeira retentativa (ms). Padrao: 400. */
  atrasoBaseMs?: number;
  /** Teto do atraso progressivo (ms). Padrao: 4000. */
  atrasoMaximoMs?: number;
  /** Teto de itens aguardando; acima disso o mais antigo e descartado. Padrao: 200. */
  maxPendentes?: number;
  /** Notificacao de mudanca de estado (diagnostico/interface). */
  aoMudar?: (estado: EstadoFila) => void;
  /** Injetavel para testes (substitui `setTimeout`). */
  esperar?: (ms: number) => Promise<void>;
}

function esperaReal(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Mantem a ordem das gravacoes, limita a concorrencia a uma e tenta de novo
 * falhas transitorias. `pausar` interrompe o processamento e aguarda a gravacao
 * em andamento; `limpar` descarta fila e falhas.
 */
export class FilaPersistencia {
  private readonly tarefas: TarefaPersistencia[] = [];
  private readonly naoGravadas: TarefaPersistencia[] = [];
  private readonly maxTentativas: number;
  private readonly atrasoBaseMs: number;
  private readonly atrasoMaximoMs: number;
  private readonly maxPendentes: number;
  private readonly aoMudar: ((estado: EstadoFila) => void) | undefined;
  private readonly esperar: (ms: number) => Promise<void>;
  private processando = false;
  private pausada = false;
  private enviados = 0;
  private falhas = 0;
  private ultimoErro: string | undefined;

  constructor(opcoes: OpcoesFila = {}) {
    this.maxTentativas = Math.max(1, opcoes.maxTentativas ?? 3);
    this.atrasoBaseMs = Math.max(0, opcoes.atrasoBaseMs ?? 400);
    this.atrasoMaximoMs = Math.max(this.atrasoBaseMs, opcoes.atrasoMaximoMs ?? 4000);
    this.maxPendentes = Math.max(1, opcoes.maxPendentes ?? 200);
    this.aoMudar = opcoes.aoMudar;
    this.esperar = opcoes.esperar ?? esperaReal;
  }

  get estado(): EstadoFila {
    return {
      enviados: this.enviados,
      falhas: this.falhas,
      pendentes: this.tarefas.length,
      ultimoErro: this.ultimoErro,
    };
  }

  /** Conteudo das gravacoes que falharam de vez, para exportacao manual. */
  get naoEnviados(): unknown[] {
    return this.naoGravadas.map((tarefa) => tarefa.payload);
  }

  /** Enfileira uma gravacao. Ignorada enquanto a fila estiver pausada. */
  agendar(tarefa: TarefaPersistencia): void {
    if (this.pausada) return;
    this.tarefas.push(tarefa);
    this.descartarExcedente();
    this.notificar();
    void this.processar();
  }

  /**
   * Para de aceitar novas gravacoes e interrompe as retentativas, aguardando a
   * gravacao em andamento terminar. Usado antes de limpar o historico, para que
   * nenhuma gravacao iniciada antes da limpeza chegue ao servidor depois dela.
   */
  async pausar(timeoutMs = 5000): Promise<void> {
    this.pausada = true;
    const limite = Date.now() + Math.max(0, timeoutMs);
    while (this.processando && Date.now() < limite) {
      await this.esperar(25);
    }
  }

  /** Volta a aceitar gravacoes depois de uma limpeza. */
  retomar(): void {
    this.pausada = false;
    if (this.tarefas.length > 0) void this.processar();
  }

  /**
   * Aguarda a fila esvaziar sem interromper o processamento nem as retentativas.
   * Diferente de `pausar`, nao para o fluxo; serve para testes e para quem
   * precisa da ordem garantida.
   */
  async aguardar(timeoutMs = 10000): Promise<void> {
    const limite = Date.now() + Math.max(0, timeoutMs);
    while ((this.processando || this.tarefas.length > 0) && Date.now() < limite) {
      await this.esperar(10);
    }
  }

  /** Descarta fila, falhas e contadores (usado ao limpar o historico). */
  limpar(): void {
    this.tarefas.length = 0;
    this.naoGravadas.length = 0;
    this.enviados = 0;
    this.falhas = 0;
    this.ultimoErro = undefined;
    this.notificar();
  }

  private async processar(): Promise<void> {
    if (this.processando) return;
    this.processando = true;
    try {
      while (!this.pausada && this.tarefas.length > 0) {
        const tarefa = this.tarefas.shift();
        if (!tarefa) break;
        const ok = await this.executar(tarefa);
        if (ok) this.enviados += 1;
        else this.registrarFalha(tarefa);
        this.notificar();
      }
    } finally {
      this.processando = false;
      this.notificar();
      if (!this.pausada && this.tarefas.length > 0) void this.processar();
    }
  }

  private async executar(tarefa: TarefaPersistencia): Promise<boolean> {
    for (let tentativa = 1; tentativa <= this.maxTentativas; tentativa += 1) {
      try {
        await tarefa.executar();
        return true;
      } catch (err) {
        this.ultimoErro = err instanceof Error ? err.message : String(err);
        if (this.pausada) return false;
        if (tentativa < this.maxTentativas) await this.esperar(this.atraso(tentativa));
      }
    }
    return false;
  }

  private atraso(tentativa: number): number {
    return Math.min(this.atrasoBaseMs * 2 ** (tentativa - 1), this.atrasoMaximoMs);
  }

  private registrarFalha(tarefa: TarefaPersistencia): void {
    this.falhas += 1;
    this.naoGravadas.push(tarefa);
    try {
      tarefa.aoFalhar?.();
    } catch {
      // Uma falha ao marcar a interface nao pode derrubar a fila.
    }
  }

  private descartarExcedente(): void {
    while (this.tarefas.length > this.maxPendentes) {
      const descartada = this.tarefas.shift();
      if (!descartada) return;
      this.ultimoErro = `fila cheia: descartado ${descartada.descricao}`;
      this.registrarFalha(descartada);
    }
  }

  private notificar(): void {
    try {
      this.aoMudar?.(this.estado);
    } catch {
      // Uma falha na notificacao da interface nao pode derrubar a fila.
    }
  }
}
