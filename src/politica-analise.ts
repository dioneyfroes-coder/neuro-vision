import type { EntradaLog, EventoVisual, MotivoAnalise } from "./types";

export type { MotivoAnalise };

/**
 * Fase 5 — fluxo de analise orientado a eventos.
 *
 * A percepcao leve (deteccao + rastreamento) roda em todo tick; o modelo de
 * visao caro (Ollama) so e chamado quando a politica decide que ha motivo:
 * mudanca relevante, nova entidade, baixa confianca, resumo periodico,
 * pedido manual ou falha da percepcao leve (nunca tratada como ausencia de
 * mudanca).
 *
 * Toda chamada automatica — inclusive `falha_percepcao` — respeita o cooldown
 * e o limite por janela. Apenas a acao manual (`manual: true`) ignora ambos.
 */

export interface AvaliacaoAnalise {
  acionar: boolean;
  motivo: MotivoAnalise | "sem_acao";
}

export interface ConfigPoliticaAnalise {
  /** Intervalo minimo entre chamadas ao Ollama (anti-sequencia em cenas instaveis). */
  cooldownMs: number;
  /** Janela deslizante para contar chamadas. */
  janelaMs: number;
  /** Maximo de chamadas dentro da janela. */
  maxChamadasPorJanela: number;
  /** Mesmo sem mudanca, re-analisar a cada `resumoPeriodicoMs`. `0` desativa. */
  resumoPeriodicoMs: number;
  /** Abaixo deste score, uma deteccao e considerada duvidosa e manda para o Ollama. */
  confiancaAlta: number;
  /** Minimo de eventos de movimento no frame para acionar o Ollama. */
  movimentoMinimo: number;
}

export const CONFIG_POLITICA_PADRAO: ConfigPoliticaAnalise = {
  cooldownMs: 10_000,
  janelaMs: 60_000,
  maxChamadasPorJanela: 4,
  resumoPeriodicoMs: 60_000,
  confiancaAlta: 0.6,
  movimentoMinimo: 1,
};

export function configurarPolitica(parcial: Partial<ConfigPoliticaAnalise>): ConfigPoliticaAnalise {
  return { ...CONFIG_POLITICA_PADRAO, ...parcial };
}

export interface EntradaPolitica {
  agora: number;
  /** Eventos estruturados do frame (rastreador + detector de cena). */
  eventos: EventoVisual[];
  /** Menor score das deteccoes do frame; `null` quando nada foi detectado. */
  melhorConfianca: number | null;
  /** `false` quando a percepcao leve falhou — nunca vira "sem mudanca". */
  percepcaoValida: boolean;
  /** O usuario pediu analise manual imediata (ignora cooldown e janela). */
  manual?: boolean;
}

/** Rótulos em portugues de cada motivo, para a interface. */
export function rotuloMotivo(motivo: MotivoAnalise): string {
  const rotulos: Record<MotivoAnalise, string> = {
    primeira_analise: "primeira analise",
    mudanca_de_cena: "mudanca de cena",
    nova_entidade: "nova entidade",
    desaparecimento: "desaparecimento",
    movimento: "movimento",
    baixa_confianca: "baixa confianca",
    resumo_periodico: "resumo periodico",
    manual: "manual",
    falha_percepcao: "falha na percepcao leve",
  };
  return rotulos[motivo];
}

/**
 * Politica com estado (cooldown e janela deslizante) que decide, a cada tick
 * da percepcao leve, se o modelo de visao deve ser acionado.
 */
export class PoliticaAnalise {
  private ultimaChamadaMs: number | null = null;
  private inicioJanelaMs = 0;
  private chamadasNaJanela = 0;

  constructor(private readonly config: ConfigPoliticaAnalise = CONFIG_POLITICA_PADRAO) {}

  /** Mara a hora em que uma chamada ao Ollama foi executada. */
  registrarChamada(agora: number): void {
    this.ultimaChamadaMs = agora;
    if (this.chamadasNaJanela === 0) {
      // Primeira chamada da janela: fixa o inicio em vez de comparar com 0.
      this.inicioJanelaMs = agora;
    } else {
      this.avancarJanela(agora);
    }
    this.chamadasNaJanela += 1;
  }

  avaliar(entrada: EntradaPolitica): AvaliacaoAnalise {
    if (entrada.manual === true) return { acionar: true, motivo: "manual" };

    // Falha da percepcao leve e estado desconhecido, nao "nada mudou".
    // Todas as chamadas automáticas respeitam cooldown e limite por janela.
    if (!entrada.percepcaoValida) {
      if (entrada.agora - (this.ultimaChamadaMs ?? 0) < this.config.cooldownMs && this.ultimaChamadaMs !== null) {
        return { acionar: false, motivo: "sem_acao" };
      }
      if (this.capacidadeDisponivel(entrada.agora)) {
        return { acionar: true, motivo: "falha_percepcao" };
      }
      return { acionar: false, motivo: "sem_acao" };
    }

    if (this.ultimaChamadaMs === null) {
      return { acionar: true, motivo: "primeira_analise" };
    }

    if (entrada.agora - this.ultimaChamadaMs < this.config.cooldownMs) {
      return { acionar: false, motivo: "sem_acao" };
    }

    if (!this.capacidadeDisponivel(entrada.agora)) {
      return { acionar: false, motivo: "sem_acao" };
    }

    const motivoEvento = this.motivoDeEventos(entrada.eventos);
    if (motivoEvento) return { acionar: true, motivo: motivoEvento };

    if (
      entrada.melhorConfianca !== null &&
      entrada.melhorConfianca < this.config.confiancaAlta
    ) {
      return { acionar: true, motivo: "baixa_confianca" };
    }

    if (
      this.config.resumoPeriodicoMs > 0 &&
      entrada.agora - this.ultimaChamadaMs >= this.config.resumoPeriodicoMs
    ) {
      return { acionar: true, motivo: "resumo_periodico" };
    }

    return { acionar: false, motivo: "sem_acao" };
  }

  /** Reinicia o estado da politica (nova sessao, historico limpo, etc.). */
  reiniciar(): void {
    this.ultimaChamadaMs = null;
    this.inicioJanelaMs = 0;
    this.chamadasNaJanela = 0;
  }

  private capacidadeDisponivel(agora: number): boolean {
    this.avancarJanela(agora);
    return this.chamadasNaJanela < this.config.maxChamadasPorJanela;
  }

  private avancarJanela(agora: number): void {
    if (this.chamadasNaJanela > 0 && agora - this.inicioJanelaMs > this.config.janelaMs) {
      this.inicioJanelaMs = agora;
      this.chamadasNaJanela = 0;
    }
  }

  private motivoDeEventos(eventos: EventoVisual[]): MotivoAnalise | null {
    const criticos: Record<string, MotivoAnalise> = {
      aparicao: "nova_entidade",
      desaparecimento: "desaparecimento",
      mudanca_de_cena: "mudanca_de_cena",
    };
    const prioridade: Record<string, number> = {
      nova_entidade: 0,
      desaparecimento: 1,
      mudanca_de_cena: 2,
    };
    let melhor: MotivoAnalise | null = null;
    let melhorPrioridade = Infinity;
    let movimentos = 0;

    for (const evento of eventos) {
      const critico = criticos[evento.tipo];
      if (critico) {
        const pri = prioridade[critico] ?? 9;
        if (pri < melhorPrioridade) {
          melhor = critico;
          melhorPrioridade = pri;
        }
      } else if (evento.tipo === "movimento") {
        movimentos += 1;
      }
    }

    if (melhor) return melhor;
    if (movimentos >= this.config.movimentoMinimo) return "movimento";
    return null;
  }
}

/** Adiciona o motivo a uma entrada para registro (Fase 5, bullet 8). */
export function comMotivo(entry: EntradaLog, motivo?: MotivoAnalise | null): EntradaLog {
  if (!motivo) return entry;
  return { ...entry, motivo };
}