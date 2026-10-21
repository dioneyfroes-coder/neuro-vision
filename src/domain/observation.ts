import type {
  ResultadoDeteccaoLocal,
  ResultadoMaos,
  ResultadoNsfw,
  ResultadoOuIndisponivel,
  ResultadoPose,
  TelemetriaSubsistema,
} from "./perception";

/**
 * Observacao de um frame (roteiro 4.2): a unidade minima de evidencia.
 *
 * `imagem` e o frame **exato** usado na percepcao e depois enviado ao modelo
 * multimodal — nunca recapturar a camera por conta propria.
 */
export interface ObservacaoFrame {
  sessionId: string;
  cycleId: string;
  frameId: string;
  /** Instante ISO da captura. */
  capturadoEm: string;
  /** Tempo monotono (ms) da captura, para intervalos. */
  capturadoEmMs: number;
  /** Evidencia exata usada na percepcao e depois no multimodal (data URL). */
  imagem: string;
  /** Thumbnail derivado dos mesmos pixels (persistencia), opcional. */
  thumb?: string;
  /** Assinatura de cena da captura, quando disponivel. */
  assinaturaCena?: number[];
  deteccoes: ResultadoOuIndisponivel<ResultadoDeteccaoLocal>;
  pose: ResultadoOuIndisponivel<ResultadoPose>;
  maos: ResultadoOuIndisponivel<ResultadoMaos>;
  /**
   * Marcacoes NSFW (experimental). **Ausente** quando o subsistema esta
   * desligado (padrao) — o `undefined` distingue "nao rodou" de "rodou e nao
   * marcou nada", preservando a regra "falha != ausencia".
   */
  nsfw?: ResultadoOuIndisponivel<ResultadoNsfw>;
  /** Instante ISO em que a inferencia local terminou. */
  inferidoEm?: string;
  metricas: {
    duracaoDeteccaoMs?: number;
    duracaoPoseMs?: number;
    duracaoMaosMs?: number;
    duracaoNsfwMs?: number;
    /**
     * Telemetria por subsistema no frame (Fase 2/3): estado, modelo,
     * dispositivo e versao usados. Alimenta o campo `subsistemas` do contexto
     * multimodal — "falha != ausencia" chega explicitamente ao modelo.
     */
    subsistemas?: Partial<Record<"deteccao" | "pose" | "maos" | "nsfw", TelemetriaSubsistema>>;
  };
}
