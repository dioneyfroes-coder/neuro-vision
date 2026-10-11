import type {
  Caixa,
  EventoVisual,
  ObjetoRastreado,
  ObjetoVisto,
  TipoEventoVisual,
} from "./types";

/** Limiares de associacao e geracao de eventos. */
export interface ConfigRastreamento {
  /** IoU minimo para associar a mesma classe entre frames. */
  iouMinimo: number;
  /** Distancia maxima (px) entre centros, como alternativa quando nao ha sobreposicao. */
  distanciaMaximaCentros: number;
  /** Frames consecutivos ausente tolerados antes de emitir `desaparecimento`. */
  maxFramesAusente: number;
  /** Idade maxima (ms) sem observacao antes de expirar um objeto. */
  expiracaoMs: number;
  /** Deslocamento minimo do centro, relativo ao tamanho da caixa, para emitir `movimento`. */
  movimentoMinimoRelativo: number;
  /** Confianca minima da deteccao para entrar no rastreamento. */
  confiancaMinima: number;
}

export const CONFIG_RASTREAMENTO_PADRAO: ConfigRastreamento = {
  iouMinimo: 0.3,
  distanciaMaximaCentros: 80,
  maxFramesAusente: 1,
  expiracaoMs: 2000,
  movimentoMinimoRelativo: 0.15,
  confiancaMinima: 0.25,
};

/** Resultado de processar um frame. */
export interface ResultadoQuadro {
  /** Estado atual dos objetos rastreados. */
  objetos: ObjetoRastreado[];
  /** Eventos gerados neste frame. */
  eventos: EventoVisual[];
}

/** Contexto compartilhado pelos eventos gerados em um frame. */
export interface ContextoQuadro {
  timestamp?: string;
  snapshot?: string;
  modelo?: string;
}

export function area(caixa: Caixa): number {
  return Math.max(0, caixa.xmax - caixa.xmin) * Math.max(0, caixa.ymax - caixa.ymin);
}

export function interseccaoSobreUniao(a: Caixa, b: Caixa): number {
  const largura = Math.max(0, Math.min(a.xmax, b.xmax) - Math.max(a.xmin, b.xmin));
  const altura = Math.max(0, Math.min(a.ymax, b.ymax) - Math.max(a.ymin, b.ymin));
  const inter = largura * altura;
  const uniao = area(a) + area(b) - inter;
  return uniao > 0 ? inter / uniao : 0;
}

export function centro(caixa: Caixa): { x: number; y: number } {
  return { x: (caixa.xmin + caixa.xmax) / 2, y: (caixa.ymin + caixa.ymax) / 2 };
}

export function distanciaCentros(a: Caixa, b: Caixa): number {
  const ca = centro(a);
  const cb = centro(b);
  return Math.hypot(ca.x - cb.x, ca.y - cb.y);
}

/**
 * Rastreador simples: associa deteccoes entre frames por classe/rotulo e
 * sobreposicao das caixas (IoU), com distancia entre centros como alternativa,
 * e produz eventos `aparicao`, `desaparecimento` e `movimento`.
 */
export class RastreadorObjetos {
  private readonly config: ConfigRastreamento;
  private objetos: ObjetoRastreado[] = [];
  private proximoId = 1;
  private proximoEvento = 1;

  constructor(config: Partial<ConfigRastreamento> = {}) {
    this.config = { ...CONFIG_RASTREAMENTO_PADRAO, ...config };
  }

  get configuracao(): ConfigRastreamento {
    return this.config;
  }

  /** Copia dos objetos atualmente rastreados. */
  get rastreados(): readonly ObjetoRastreado[] {
    return this.objetos;
  }

  /** Zera o rastreamento (novo ciclo/sessao). */
  reiniciar(): void {
    this.objetos = [];
    this.proximoId = 1;
    this.proximoEvento = 1;
  }

  /**
   * Processa as deteccoes de um frame e retorna o estado atualizado junto dos
   * eventos gerados. Associa cada deteccao a no maximo um objeto rastreado da
   * mesma classe, preferindo a maior sobreposicao.
   */
  processar(
    deteccoes: ObjetoVisto[],
    agoraMs: number,
    contexto: ContextoQuadro = {}
  ): ResultadoQuadro {
    const eventos: EventoVisual[] = [];
    const timestamp = contexto.timestamp ?? new Date().toISOString();
    const validas = deteccoes.filter((d) => d.score >= this.config.confiancaMinima);

    const associados = new Set<ObjetoRastreado>();
    const deteccoesAssociadas = new Set<ObjetoVisto>();

    for (const deteccao of validas) {
      let melhor: { objeto: ObjetoRastreado; pontuacao: number } | null = null;
      for (const objeto of this.objetos) {
        if (associados.has(objeto)) continue;
        if (objeto.rotulo !== deteccao.rotulo) continue;
        const pontuacao = this.pontuacaoAssociacao(objeto.caixa, deteccao.caixa);
        if (pontuacao === null) continue;
        if (!melhor || pontuacao > melhor.pontuacao) melhor = { objeto, pontuacao };
      }
      if (!melhor) continue;

      const { objeto } = melhor;
      associados.add(objeto);
      deteccoesAssociadas.add(deteccao);

      const deslocamento = this.deslocamentoRelativo(objeto.caixa, deteccao.caixa);
      objeto.caixa = deteccao.caixa;
      objeto.score = deteccao.score;
      objeto.nome = deteccao.nome;
      objeto.ultimaObservacao = agoraMs;
      objeto.framesVisto += 1;
      objeto.framesAusente = 0;

      if (deslocamento >= this.config.movimentoMinimoRelativo) {
        eventos.push(
          this.criarEvento("movimento", timestamp, objeto, deteccao.score, contexto, `movimento de ${objeto.nome}`)
        );
      }
    }

    for (const deteccao of validas) {
      if (deteccoesAssociadas.has(deteccao)) continue;
      const objeto: ObjetoRastreado = {
        id: `obj-${this.proximoId++}`,
        rotulo: deteccao.rotulo,
        nome: deteccao.nome,
        score: deteccao.score,
        caixa: deteccao.caixa,
        primeiraObservacao: agoraMs,
        ultimaObservacao: agoraMs,
        framesVisto: 1,
        framesAusente: 0,
      };
      this.objetos.push(objeto);
      associados.add(objeto);
      eventos.push(
        this.criarEvento("aparicao", timestamp, objeto, deteccao.score, contexto, `apareceu ${objeto.nome}`)
      );
    }

    const restantes: ObjetoRastreado[] = [];
    for (const objeto of this.objetos) {
      if (associados.has(objeto)) {
        restantes.push(objeto);
        continue;
      }
      objeto.framesAusente += 1;
      const expirou = agoraMs - objeto.ultimaObservacao > this.config.expiracaoMs;
      if (objeto.framesAusente > this.config.maxFramesAusente || expirou) {
        eventos.push(
          this.criarEvento("desaparecimento", timestamp, objeto, objeto.score, contexto, `desapareceu ${objeto.nome}`)
        );
        continue;
      }
      restantes.push(objeto);
    }
    this.objetos = restantes;

    return { objetos: [...this.objetos], eventos };
  }

  /**
   * Pontuacao de associacao: IoU quando ha sobreposicao suficiente; caso
   * contrario, uma pontuacao decrescente com a distancia entre centros.
   * Retorna `null` quando nao ha associacao plausivel.
   */
  private pontuacaoAssociacao(a: Caixa, b: Caixa): number | null {
    const iou = interseccaoSobreUniao(a, b);
    if (iou >= this.config.iouMinimo) return iou;
    const distancia = distanciaCentros(a, b);
    if (distancia <= this.config.distanciaMaximaCentros) {
      return this.config.iouMinimo * (1 - distancia / this.config.distanciaMaximaCentros);
    }
    return null;
  }

  private deslocamentoRelativo(a: Caixa, b: Caixa): number {
    const referencia = Math.max(
      1,
      Math.max(a.xmax - a.xmin, a.ymax - a.ymin)
    );
    return distanciaCentros(a, b) / referencia;
  }

  private criarEvento(
    tipo: TipoEventoVisual,
    timestamp: string,
    objeto: ObjetoRastreado,
    confianca: number,
    contexto: ContextoQuadro,
    descricao: string
  ): EventoVisual {
    return {
      id: `evt-${this.proximoEvento++}`,
      timestamp,
      tipo,
      objetoId: objeto.id,
      descricao,
      confianca,
      origem: "rastreador",
      snapshot: contexto.snapshot,
      modelo: contexto.modelo,
    };
  }
}
