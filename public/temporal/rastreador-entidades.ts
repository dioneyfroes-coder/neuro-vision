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
 * Estado explicito do ciclo de vida do track.
 *
 * - `ativa`: observada no frame corrente;
 * - `ausente`: ainda dentro da janela de tolerancia por frames, mas nao vista;
 * - `perdida`: saiu da janela ativa; permanece reassociavel enquanto
 *   `maxTempoAusenteMs` nao expirar.
 */
export type EstadoEntidade = "ativa" | "ausente" | "perdida";

/**
 * Entidade rastreada com ID estavel dentro da sessao.
 *
 * O centro e suavizado exponencialmente; `deslocamento` e a magnitude do
 * movimento entre os dois ultimos passos (tambem suavizada).
 */
export interface Entidade {
  entidadeId: string;
  /** Estado corrente do ciclo de vida do track. */
  estado: EstadoEntidade;
  x: number;
  y: number;
  deslocamento: number;
  /** Componente vertical do movimento (negativa = subindo). */
  deslocamentoY: number;
  /** Velocidade instantanea normalizada por segundo no ultimo intervalo valido. */
  velocidade: number;
  /** Componente vertical da velocidade (negativa = subindo). */
  velocidadeY: number;
  /**
   * `false` quando o ultimo intervalo foi invalido (`<= 0`, nao finito) ou
   * excessivamente longo. Nesse caso a velocidade e zerada: nao se presume
   * movimento atraves de uma lacuna.
   */
  velocidadeValida: boolean;
  /** Intervalo (ms) efetivamente usado na ultima velocidade valida. */
  intervaloVelocidadeMs?: number;
  confianca: number;
  framesVisto: number;
  framesAusente: number;
  /** Quantas vezes o track foi reassociado depois de ter sido dado como perdido. */
  reassociacoes: number;
  primeiraObservacaoMs: number;
  ultimaObservacaoMs: number;
  meta: Record<string, unknown>;
}

/**
 * Associacao entre a sonda de um frame e a entidade rastreada.
 *
 * `indice` e a posicao da sonda na lista recebida por `atualizar` (o mesmo
 * indice da pessoa/mao no resultado do adaptador). Permite enriquecer as
 * observacoes por copia, sem depender de ordem de insercao do rastreador.
 */
export interface AssociacaoSonda {
  indice: number;
  entidadeId: string;
}

/** Resultado de uma atualizacao: entidades atualizadas e mapa sonda->entidade. */
export interface ResultadoRastreamento {
  entidades: Entidade[];
  associacoes: AssociacaoSonda[];
}

/**
 * Rastreador generico de entidades com IDs estaveis na sessao.
 *
 * Associa sondas a entidades vivas pela menor distancia (guloso), desde que
 * abaixo de `distanciaMaxima`. Entidades que passam de `maxFramesAusente` saem
 * da janela ativa para um **buffer de perdidas**, onde continuam reassociaveis
 * dentro de `maxTempoAusenteMs` e de `distanciaReassociacaoMaxima`; reassociar
 * preserva o ID, mas nao presume movimento/velocidade atraves da lacuna.
 * A expiracao e **temporal** e explicita: tanto ativas quanto perdidas sem
 * observacao ha mais de `maxTempoAusenteMs` sao descartadas em cada atualizacao.
 * O estado persiste entre chamadas (entre ciclos) ate `limpar()` ser chamado.
 */
export class RastreadorEntidades {
  private readonly config: ConfigRastreador;
  private readonly prefixo: string;
  private contador = 0;
  private readonly entidades = new Map<string, Entidade>();
  /** Entidades fora da janela ativa, ainda reassociaveis dentro do tempo maximo. */
  private readonly entidadesPerdidas = new Map<string, Entidade>();
  /** Posicoes brutas (nao suavizadas) para medir deslocamento. */
  private readonly posicoesBrutas = new Map<string, Ponto2D>();

  constructor(config?: Partial<ConfigRastreador>, prefixo = "ent") {
    this.config = { ...CONFIG_RASTREADOR_PADRAO, ...config };
    this.prefixo = prefixo;
  }

  /** Entidades vivas (ativas ou ausentes dentro da tolerancia) na ordem de atualizacao. */
  get vivas(): Entidade[] {
    return [...this.entidades.values()];
  }

  /** Entidades perdidas, ainda reassociaveis enquanto nao expirarem por tempo. */
  get perdidas(): Entidade[] {
    return [...this.entidadesPerdidas.values()];
  }

  /**
   * Atualiza o rastreamento e devolve, alem das entidades, o mapa explicito
   * entre o indice de cada sonda e o `entidadeId` associado.
   *
   * @param sondas pontos de referencia detectados no frame (podem estar vazios
   *               quando o subsistema falhou ou a entidade sumiu).
   * @param tempoMs tempo monotono (ms) do frame.
   */
  atualizarComAssociacoes(
    sondas: Sonda[],
    tempoMs: number,
    podeAssociar?: (entidade: Entidade, sonda: Sonda) => boolean
  ): ResultadoRastreamento {
    // Expiracao temporal no inicio da atualizacao: uma entidade nao observada
    // por tempo demais nao deve sobreviver a lacunas longas entre ciclos. Vale
    // para ativas e para o buffer de perdidas.
    this.expirarPorTempo(tempoMs);

    const naoAssociadas = sondas.map((sonda, indice) => ({ sonda, indice }));
    const atualizadas = new Set<string>();
    const associacoes: AssociacaoSonda[] = [];

    // 1. Entidades ativas: guloso pela menor distancia dentro de `distanciaMaxima`.
    for (const entidade of this.vivas) {
      const melhor = this.escolherSonda(
        entidade,
        naoAssociadas,
        this.config.distanciaMaxima,
        podeAssociar
      );
      if (melhor) {
        naoAssociadas.splice(melhor.indiceLista, 1);
        this.aplicar(entidade, melhor.item.sonda, tempoMs);
        atualizadas.add(entidade.entidadeId);
        associacoes.push({ indice: melhor.item.indice, entidadeId: entidade.entidadeId });
      } else {
        entidade.framesAusente += 1;
        entidade.estado = "ausente";
      }
    }

    // 2. Entidades perdidas: reassociacao explicita com raio maior, ainda
    //    limitada por `maxTempoAusenteMs` (ja expirado acima). Preserva o ID,
    //    mas zera velocidade/deslocamento: a lacuna nao vira movimento.
    for (const entidade of [...this.entidadesPerdidas.values()]) {
      const melhor = this.escolherSonda(
        entidade,
        naoAssociadas,
        this.config.distanciaReassociacaoMaxima,
        podeAssociar
      );
      if (!melhor) continue;
      naoAssociadas.splice(melhor.indiceLista, 1);
      this.reassociar(entidade, melhor.item.sonda, tempoMs);
      atualizadas.add(entidade.entidadeId);
      associacoes.push({ indice: melhor.item.indice, entidadeId: entidade.entidadeId });
    }

    // 3. Sondas restantes viram entidades novas.
    for (const item of naoAssociadas) {
      const nova = this.criar(item.sonda, tempoMs);
      atualizadas.add(nova.entidadeId);
      associacoes.push({ indice: item.indice, entidadeId: nova.entidadeId });
    }

    // 4. So agora entidades que passaram da tolerancia por frames viram
    //    perdidas. No mesmo frame, uma sonda distante continua exigindo
    //    `distanciaMaxima` (nao reassocia por um salto grande isolado).
    for (const entidade of this.vivas) {
      if (entidade.framesAusente > this.config.maxFramesAusente) {
        this.moverParaPerdidas(entidade);
      }
    }

    associacoes.sort((a, b) => a.indice - b.indice);
    return {
      entidades: this.vivas.filter((e) => atualizadas.has(e.entidadeId)),
      associacoes,
    };
  }

  /** Escolhe a sonda mais proxima de uma entidade dentro do raio informado. */
  private escolherSonda(
    entidade: Entidade,
    candidatas: Array<{ sonda: Sonda; indice: number }>,
    distanciaMaxima: number,
    podeAssociar?: (entidade: Entidade, sonda: Sonda) => boolean
  ): { item: { sonda: Sonda; indice: number }; indiceLista: number } | null {
    let melhor: { sonda: Sonda; indice: number } | null = null;
    let melhorDist = Infinity;
    let indiceLista = -1;
    for (let i = 0; i < candidatas.length; i += 1) {
      const item = candidatas[i];
      if (podeAssociar && !podeAssociar(entidade, item.sonda)) continue;
      const d = distanciaPontos(entidade, item.sonda);
      if (d < melhorDist) {
        melhorDist = d;
        melhor = item;
        indiceLista = i;
      }
    }
    if (!melhor || melhorDist > distanciaMaxima) return null;
    return { item: melhor, indiceLista };
  }

  /**
   * Atualiza o rastreamento com as sondas de um frame e devolve as entidades
   * atualizadas (uma por sonda associada). Mantido para consumidores que nao
   * precisam do mapa de indices.
   */
  atualizar(sondas: Sonda[], tempoMs: number): Entidade[] {
    return this.atualizarComAssociacoes(sondas, tempoMs).entidades;
  }

  /** Busca uma entidade por ID, ativa ou perdida. */
  obter(entidadeId: string): Entidade | undefined {
    return this.entidades.get(entidadeId) ?? this.entidadesPerdidas.get(entidadeId);
  }

  /** Limpa todo o estado (reset explicito de sessao). */
  limpar(): void {
    this.entidades.clear();
    this.entidadesPerdidas.clear();
    this.posicoesBrutas.clear();
    this.contador = 0;
  }

  /** Remove entidades (ativas ou perdidas) sem observacao ha mais de `maxTempoAusenteMs`. */
  private expirarPorTempo(tempoMs: number): void {
    for (const entidade of [...this.entidades.values()]) {
      if (tempoMs - entidade.ultimaObservacaoMs > this.config.maxTempoAusenteMs) {
        this.entidades.delete(entidade.entidadeId);
        this.posicoesBrutas.delete(entidade.entidadeId);
      }
    }
    for (const entidade of [...this.entidadesPerdidas.values()]) {
      if (tempoMs - entidade.ultimaObservacaoMs > this.config.maxTempoAusenteMs) {
        this.entidadesPerdidas.delete(entidade.entidadeId);
      }
    }
  }

  /** Move uma entidade da janela ativa para o buffer de perdidas. */
  private moverParaPerdidas(entidade: Entidade): void {
    this.entidades.delete(entidade.entidadeId);
    this.posicoesBrutas.delete(entidade.entidadeId);
    entidade.estado = "perdida";
    this.entidadesPerdidas.set(entidade.entidadeId, entidade);
  }

  private criar(sonda: Sonda, tempoMs: number): Entidade {
    this.contador += 1;
    const entidade: Entidade = {
      entidadeId: `${this.prefixo}-${this.contador}`,
      estado: "ativa",
      x: sonda.x,
      y: sonda.y,
      deslocamento: 0,
      deslocamentoY: 0,
      velocidade: 0,
      velocidadeY: 0,
      velocidadeValida: false,
      confianca: sonda.confianca,
      framesVisto: 1,
      framesAusente: 0,
      reassociacoes: 0,
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
      const intervaloMs = tempoMs - entidade.ultimaObservacaoMs;
      const intervaloValido =
        Number.isFinite(intervaloMs) && intervaloMs > 0 && intervaloMs <= this.config.maxTempoAusenteMs;
      const metrica = medirMovimento(anterior, bruto);
      entidade.deslocamento =
        this.config.alphaSuavizacao * entidade.deslocamento +
        (1 - this.config.alphaSuavizacao) * metrica.deslocamento;
      entidade.deslocamentoY =
        this.config.alphaSuavizacao * entidade.deslocamentoY +
        (1 - this.config.alphaSuavizacao) * metrica.deslocamentoY;
      entidade.velocidadeValida = intervaloValido;
      entidade.intervaloVelocidadeMs = intervaloValido ? intervaloMs : undefined;
      entidade.velocidade = intervaloValido ? (metrica.deslocamento * 1000) / intervaloMs : 0;
      entidade.velocidadeY = intervaloValido ? (metrica.deslocamentoY * 1000) / intervaloMs : 0;
    } else {
      entidade.velocidadeValida = false;
      entidade.intervaloVelocidadeMs = undefined;
    }
    const suavizado = suavizarPonto(this.config.alphaSuavizacao, anterior, bruto);
    entidade.estado = "ativa";
    entidade.x = suavizado.x;
    entidade.y = suavizado.y;
    entidade.confianca = sonda.confianca;
    entidade.framesVisto += 1;
    entidade.framesAusente = 0;
    entidade.ultimaObservacaoMs = tempoMs;
    if (sonda.meta) entidade.meta = { ...entidade.meta, ...sonda.meta };
    this.posicoesBrutas.set(entidade.entidadeId, bruto);
  }

  /**
   * Reassocia uma entidade perdida: preserva o ID e reinicia a continuidade.
   *
   * Diferente de `aplicar`, nao usa a posicao anterior para medir deslocamento
   * nem velocidade — a lacuna nao e movimento observado. O centro volta ao
   * ponto atual para nao herdar suavizacao de um instante antigo.
   */
  private reassociar(entidade: Entidade, sonda: Sonda, tempoMs: number): void {
    this.entidadesPerdidas.delete(entidade.entidadeId);
    entidade.estado = "ativa";
    entidade.reassociacoes += 1;
    entidade.x = sonda.x;
    entidade.y = sonda.y;
    entidade.deslocamento = 0;
    entidade.deslocamentoY = 0;
    entidade.velocidade = 0;
    entidade.velocidadeY = 0;
    entidade.velocidadeValida = false;
    entidade.intervaloVelocidadeMs = undefined;
    entidade.confianca = sonda.confianca;
    entidade.framesVisto += 1;
    entidade.framesAusente = 0;
    entidade.ultimaObservacaoMs = tempoMs;
    if (sonda.meta) entidade.meta = { ...entidade.meta, ...sonda.meta };
    this.posicoesBrutas.set(entidade.entidadeId, { x: sonda.x, y: sonda.y });
    this.entidades.set(entidade.entidadeId, entidade);
  }
}
