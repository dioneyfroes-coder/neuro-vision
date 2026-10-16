import type { ConfigRastreador } from "./contracts";
import { CONFIG_RASTREADOR_PADRAO } from "./contracts";
import {
  distanciaPontos,
  medirMovimento,
  suavizarPonto,
  type Ponto2D,
} from "./suavizador";

/**
 * Sonda: ponto de referencia de uma deteccao em coordenadas normalizadas.
 *
 * Pose e maos ja sao normalizados pelos adaptadores; caixas de objeto devem ser
 * normalizadas pelo chamador quando as dimensoes forem conhecidas.
 */
export interface Sonda {
  x: number;
  y: number;
  /** Confianca agregada da deteccao, em [0,1]. */
  confianca: number;
  /** Dados arbitrarios preservados na entidade (lateralidade, rotulo, etc.). */
  meta?: Record<string, unknown>;
}

/**
 * Entidade rastreada com ID estavel dentro da sessao.
 *
 * O centro e suavizado exponencialmente; `deslocamento` e a magnitude do
 * movimento entre os dois ultimos passos (tambem suavizada).
 */
export interface Entidade {
  entidadeId: string;
  x: number;
  y: number;
  deslocamento: number;
  /** Componente vertical do movimento (negativa = subindo). */
  deslocamentoY: number;
  confianca: number;
  framesVisto: number;
  framesAusente: number;
  primeiraObservacaoMs: number;
  ultimaObservacaoMs: number;
  meta: Record<string, unknown>;
}

/**
 * Rastreador generico de entidades com IDs estaveis na sessao.
 *
 * Associa sondas a entidades vivas pela menor distancia (guloso), desde que
 * abaixo de `distanciaMaxima`. Entidades ausentes por mais de
 * `maxFramesAusente` frames sao descartadas. O estado persiste entre chamadas
 * (entre ciclos) ate `limpar()` ser chamado.
 */
export class RastreadorEntidades {
  private readonly config: ConfigRastreador;
  private readonly prefixo: string;
  private contador = 0;
  private readonly entidades = new Map<string, Entidade>();
  /** Posicoes brutas (nao suavizadas) para medir deslocamento. */
  private readonly posicoesBrutas = new Map<string, Ponto2D>();

  constructor(config?: Partial<ConfigRastreador>, prefixo = "ent") {
    this.config = { ...CONFIG_RASTREADOR_PADRAO, ...config };
    this.prefixo = prefixo;
  }

  /** Entidades vivas na ordem em que foram atualizadas. */
  get vivas(): Entidade[] {
    return [...this.entidades.values()];
  }

  /**
   * Atualiza o rastreamento com as sondas de um frame.
   *
   * @param sondas pontos de referencia detectados no frame (podem estar vazios
   *               quando o subsistema falhou ou a entidade sumiu).
   * @param tempoMs tempo monotono (ms) do frame.
   * @returns as entidades vivas apos a atualizacao.
   */
  atualizar(sondas: Sonda[], tempoMs: number): Entidade[] {
    const naoAssociadas = [...sondas];
    const entidadesVivas = this.vivas;
    const atualizadas = new Set<string>();

    // Guloso: para cada entidade viva, associa a sonda mais proxima disponivel.
    for (const entidade of entidadesVivas) {
      let melhor: Sonda | null = null;
      let melhorDist = Infinity;
      let melhorIdx = -1;
      for (let i = 0; i < naoAssociadas.length; i += 1) {
        const sonda = naoAssociadas[i];
        const d = distanciaPontos(entidade, sonda);
        if (d < melhorDist) {
          melhorDist = d;
          melhor = sonda;
          melhorIdx = i;
        }
      }
      if (melhor && melhorDist <= this.config.distanciaMaxima) {
        naoAssociadas.splice(melhorIdx, 1);
        this.aplicar(entidade, melhor, tempoMs);
        atualizadas.add(entidade.entidadeId);
      } else {
        entidade.framesAusente += 1;
      }
    }

    // Descarta entidades ausentes ha tempo demais.
    for (const entidade of entidadesVivas) {
      if (entidade.framesAusente > this.config.maxFramesAusente) {
        this.entidades.delete(entidade.entidadeId);
        this.posicoesBrutas.delete(entidade.entidadeId);
      }
    }

    // Cria entidades novas para as sondas restantes.
    for (const sonda of naoAssociadas) {
      const nova = this.criar(sonda, tempoMs);
      atualizadas.add(nova.entidadeId);
    }

    return this.vivas.filter((e) => atualizadas.has(e.entidadeId));
  }

  /** Busca uma entidade viva por ID. */
  obter(entidadeId: string): Entidade | undefined {
    return this.entidades.get(entidadeId);
  }

  /** Limpa todo o estado (reset explicito de sessao). */
  limpar(): void {
    this.entidades.clear();
    this.posicoesBrutas.clear();
    this.contador = 0;
  }

  private criar(sonda: Sonda, tempoMs: number): Entidade {
    this.contador += 1;
    const entidade: Entidade = {
      entidadeId: `${this.prefixo}-${this.contador}`,
      x: sonda.x,
      y: sonda.y,
      deslocamento: 0,
      deslocamentoY: 0,
      confianca: sonda.confianca,
      framesVisto: 1,
      framesAusente: 0,
      primeiraObservacaoMs: tempoMs,
      ultimaObservacaoMs: tempoMs,
      meta: { ...sonda.meta },
    };
    this.entidades.set(entidade.entidadeId, entidade);
    this.posicoesBrutas.set(entidade.entidadeId, { x: sonda.x, y: sonda.y });
    return entidade;
  }

  private aplicar(entidade: Entidade, sonda: Sonda, tempoMs: number): void {
    const anterior = this.posicoesBrutas.get(entidade.entidadeId) ?? null;
    const bruto = { x: sonda.x, y: sonda.y };
    if (anterior) {
      const metrica = medirMovimento(anterior, bruto);
      entidade.deslocamento =
        this.config.alphaSuavizacao * entidade.deslocamento +
        (1 - this.config.alphaSuavizacao) * metrica.deslocamento;
      entidade.deslocamentoY =
        this.config.alphaSuavizacao * entidade.deslocamentoY +
        (1 - this.config.alphaSuavizacao) * metrica.deslocamentoY;
    }
    const suavizado = suavizarPonto(this.config.alphaSuavizacao, anterior, bruto);
    entidade.x = suavizado.x;
    entidade.y = suavizado.y;
    entidade.confianca = sonda.confianca;
    entidade.framesVisto += 1;
    entidade.framesAusente = 0;
    entidade.ultimaObservacaoMs = tempoMs;
    if (sonda.meta) entidade.meta = { ...entidade.meta, ...sonda.meta };
    this.posicoesBrutas.set(entidade.entidadeId, bruto);
  }
}
