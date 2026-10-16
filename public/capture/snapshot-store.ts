import type { Dimensoes } from "../perception/contracts";

/**
 * Snapshot capturado e **identificado** (Etapa 4 do roteiro): a evidencia bruta
 * de um frame — imagem, id e instante — guardada antes de qualquer inferencia.
 *
 * O objeto e imutavel (`Object.freeze`): a imagem usada na deteccao e a mesma
 * que sera registrada e enviada a interpretacao multimodal, sem recaptura.
 */
export interface SnapshotCapturado {
  /** Id do frame no ciclo (ex.: `sess-c1-f0`). */
  frameId: string;
  /** Frame como data URL JPEG, na resolucao de analise. */
  imagem: string;
  /** Thumbnail derivado dos mesmos pixels (persistencia/exibicao). */
  thumb?: string;
  /** Instante ISO da captura (relogio de parede). */
  capturadoEm: string;
  /** Instante monotonico (ms) da captura, para intervalos. */
  capturadoEmMs: number;
  /** Dimensoes da imagem capturada. */
  dimensoes?: Dimensoes;
  /** Assinatura de cena da captura, quando disponivel. */
  assinaturaCena?: number[];
}

/** Limites de memoria do buffer de snapshots. */
export interface LimitesSnapshotStore {
  /** Numero maximo de snapshots retidos; os mais antigos sao descartados. */
  maxQuadros: number;
}

export const LIMITES_PADRAO: LimitesSnapshotStore = { maxQuadros: 4 };

/**
 * Buffer de snapshots do ciclo, com retencao limitada (roteiro 4.2/4.7).
 *
 * Nao captura e nao infere: apenas guarda os frames ja identificados e permite
 * limpar o buffer ao parar a sessao ou ao falhar o ciclo, para nao reter
 * imagens em memoria.
 */
export class SnapshotStore {
  private readonly itens: SnapshotCapturado[] = [];
  private readonly limites: LimitesSnapshotStore;

  constructor(limites: LimitesSnapshotStore = LIMITES_PADRAO) {
    this.limites = { ...limites };
  }

  /** Adiciona um snapshot, congelando-o e descartando os mais antigos. */
  adicionar(snapshot: SnapshotCapturado): SnapshotCapturado {
    const congelado = Object.freeze({ ...snapshot });
    this.itens.push(congelado);
    while (this.itens.length > this.limites.maxQuadros) {
      this.itens.shift();
    }
    return congelado;
  }

  /** Visao imutavel e ordenada (mais antigo primeiro) dos snapshots retidos. */
  get quadros(): readonly SnapshotCapturado[] {
    return this.itens;
  }

  get tamanho(): number {
    return this.itens.length;
  }

  /** Libera o buffer (parada de sessao ou falha do ciclo). */
  limpar(): void {
    this.itens.length = 0;
  }
}
