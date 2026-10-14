import type { EventoVisual } from "./types";

/** Assinatura de cena: luminancia media por celula de uma grade pequena. */
export type AssinaturaCena = number[];

/** Diferenca media absoluta entre duas assinaturas, normalizada em [0, 1]. */
export function diferencaDeCena(a: AssinaturaCena, b: AssinaturaCena): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let soma = 0;
  for (let i = 0; i < n; i += 1) soma += Math.abs(a[i] - b[i]);
  return soma / n / 255;
}

export interface ConfigMudancaDeCena {
  /** Diferenca media minima (0..1) para sinalizar mudanca de cena. */
  limiarDiferenca: number;
  /** Intervalo minimo (ms) entre eventos de mudanca, para evitar repeticoes. */
  intervaloMinimoMs: number;
}

export const CONFIG_MUDANCA_DE_CENA_PADRAO: ConfigMudancaDeCena = {
  limiarDiferenca: 0.2,
  intervaloMinimoMs: 1000,
};

export interface ContextoCena {
  timestamp?: string;
  snapshot?: string;
  modelo?: string;
  sessaoId?: string;
}

/**
 * Detector de mudanca ampla de cena. Emite `mudanca_de_cena` apenas como
 * **sinal** para uma analise adicional — nunca como prova semantica de que algo
 * especifico aconteceu.
 */
export class DetectorMudancaDeCena {
  private readonly config: ConfigMudancaDeCena;
  private anterior: AssinaturaCena | null = null;
  private ultimoEventoMs: number | null = null;
  private proximoEvento = 1;
  private sessaoId?: string;

  constructor(config: Partial<ConfigMudancaDeCena> = {}, sessaoId?: string) {
    this.config = { ...CONFIG_MUDANCA_DE_CENA_PADRAO, ...config };
    this.sessaoId = sessaoId;
  }

  reiniciar(): void {
    this.anterior = null;
    this.ultimoEventoMs = null;
    this.proximoEvento = 1;
  }

  /** Troca a sessao (nova execucao ou apos limpar o historico). */
  definirSessao(sessaoId: string): void {
    this.sessaoId = sessaoId;
  }

  /**
   * Avalia a assinatura do frame atual. Retorna um evento de sinal quando a
   * diferenca em relacao ao frame anterior supera o limiar (o primeiro frame
   * apenas registra a base).
   */
  avaliar(
    assinatura: AssinaturaCena | null,
    agoraMs: number,
    contexto: ContextoCena = {}
  ): EventoVisual | null {
    if (assinatura === null) return null;
    const anterior = this.anterior;
    this.anterior = assinatura;
    if (anterior === null) return null;

    const diferenca = diferencaDeCena(anterior, assinatura);
    if (diferenca < this.config.limiarDiferenca) return null;
    if (this.ultimoEventoMs !== null && agoraMs - this.ultimoEventoMs < this.config.intervaloMinimoMs) {
      return null;
    }

    this.ultimoEventoMs = agoraMs;
    return {
      id: this.sessaoId ? `cena-${this.sessaoId}-${this.proximoEvento++}` : `cena-${this.proximoEvento++}`,
      timestamp: contexto.timestamp ?? new Date().toISOString(),
      tipo: "mudanca_de_cena",
      descricao: "mudanca de cena (sinal para analise adicional)",
      confianca: Number(diferenca.toFixed(3)),
      origem: "detector",
      snapshot: contexto.snapshot,
      modelo: contexto.modelo,
      sessaoId: contexto.sessaoId ?? this.sessaoId,
    };
  }
}
