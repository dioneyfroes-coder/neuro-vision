import { QuadroRejeitadoError } from "../domain";

/**
 * Buffer circular de quadros para o pré-evento (Fase 3).
 *
 * Guarda os últimos `retencaoMs` de quadros por tempo de captura, com limite
 * opcional de capacidade. Quando um evento dispara, `instantaneo()` entrega a
 * janela que já inclui os segundos anteriores ao gatilho — a análise não começa
 * apenas depois da detecção.
 *
 * O buffer é determinístico: a retenção é medida pelo timestamp do quadro mais
 * recente, nunca pelo relógio de parede. O tempo só avança (quadros fora de
 * ordem são rejeitados) e a saída é sempre uma cópia estrutural: alterar o
 * array ou os metadados devolvidos não modifica o buffer.
 */

export interface ConfigBufferCircular<T> {
  /** Tempo de histórico a manter antes do quadro mais recente. */
  retencaoMs: number;
  /** Teto opcional de quadros (o mais antigo é descartado primeiro). */
  capacidadeMaxima?: number;
  /** Cópia profunda opcional do item; sem ela a saída copia apenas o envelope. */
  clonarItem?: (item: T) => T;
}

/** Quadro retido com seu instante de captura. */
export interface QuadroBuffer<T> {
  item: T;
  capturadoEmMs: number;
}

const LIMITE_DATA_MS = 8.64e15;

function instanteValido(ms: number): boolean {
  return Number.isFinite(ms) && Math.abs(ms) <= LIMITE_DATA_MS;
}

export class BufferCircularQuadros<T> {
  private readonly itens: QuadroBuffer<T>[] = [];
  private readonly retencao: number;
  private readonly capacidade: number | undefined;
  private readonly clonar: ((item: T) => T) | undefined;
  private ultimoMs: number | null = null;

  constructor(config: ConfigBufferCircular<T>) {
    if (!Number.isFinite(config.retencaoMs) || config.retencaoMs <= 0) {
      throw new Error("retencaoMs deve ser finito e maior que zero");
    }
    if (config.capacidadeMaxima !== undefined) {
      if (
        !Number.isFinite(config.capacidadeMaxima) ||
        !Number.isInteger(config.capacidadeMaxima) ||
        config.capacidadeMaxima < 1
      ) {
        throw new Error("capacidadeMaxima deve ser um inteiro maior que zero");
      }
    }
    // Copia a configuracao: alterar o objeto recebido depois nao muda a janela.
    this.retencao = config.retencaoMs;
    this.capacidade = config.capacidadeMaxima;
    this.clonar = config.clonarItem;
  }

  /** Adiciona um quadro; timestamps fora de ordem são recusados. */
  adicionar(item: T, capturadoEmMs: number): void {
    if (!instanteValido(capturadoEmMs)) {
      throw new QuadroRejeitadoError(
        "tempo_invalido",
        "Buffer circular recebeu um instante de captura invalido"
      );
    }
    if (this.ultimoMs !== null && capturadoEmMs < this.ultimoMs) {
      throw new QuadroRejeitadoError(
        "fora_de_ordem",
        `Buffer circular recebeu ${capturadoEmMs} depois de ${this.ultimoMs}`
      );
    }

    this.itens.push({
      item: this.clonar ? this.clonar(item) : item,
      capturadoEmMs,
    });
    this.ultimoMs = capturadoEmMs;
    this.podarPorTempo(capturadoEmMs);
    this.podarPorCapacidade();
  }

  /** Cópia da janela retida, do mais antigo para o mais recente. */
  instantaneo(): QuadroBuffer<T>[] {
    return this.itens.map((quadro) => ({
      item: this.clonar ? this.clonar(quadro.item) : quadro.item,
      capturadoEmMs: quadro.capturadoEmMs,
    }));
  }

  get tamanho(): number {
    return this.itens.length;
  }

  get retencaoMs(): number {
    return this.retencao;
  }

  get maisRecenteMs(): number | undefined {
    return this.ultimoMs ?? undefined;
  }

  get maisAntigoMs(): number | undefined {
    return this.itens[0]?.capturadoEmMs;
  }

  limpar(): void {
    this.itens.length = 0;
    this.ultimoMs = null;
  }

  private podarPorTempo(agoraMs: number): void {
    const limite = agoraMs - this.retencao;
    while (this.itens.length > 0 && this.itens[0].capturadoEmMs < limite) {
      this.itens.shift();
    }
  }

  private podarPorCapacidade(): void {
    if (this.capacidade === undefined) return;
    while (this.itens.length > this.capacidade) this.itens.shift();
  }
}
