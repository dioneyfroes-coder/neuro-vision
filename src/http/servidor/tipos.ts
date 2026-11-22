import type { ArmazenadorVideos } from "../../persistence/armazenador-videos";

export interface ServerConfig {
  logFile?: string;
  snapDir?: string;
  publicDir?: string;
  /** URL base do backend de visao (LM Studio). */
  backendUrl?: string;
  /** Chave de API do backend (LM Studio ignora). */
  apiKey?: string;
  /** Arquivo de eventos estruturados. Padrao: `eventos.jsonl` ao lado do log. */
  eventosFile?: string;
  /**
   * Arquivo da memoria de gestos/posturas (P2.6). Padrao:
   * `eventos-temporais.jsonl` ao lado do log.
   */
  eventosTemporaisFile?: string;
  /** Arquivo de registros operacionais. Padrao: `operacional.jsonl` ao lado do log. */
  operacionalFile?: string;
  /** Arquivo de diagnosticos de ciclo. Padrao: `ciclos.jsonl` ao lado do log. */
  ciclosFile?: string;
  /** Indice de sessoes de monitoramento. Padrao: `monitoramento-sessoes.jsonl`. */
  monitoramentoSessoesFile?: string;
  /** Indice de segmentos de monitoramento. Padrao: `monitoramento-segmentos.jsonl`. */
  monitoramentoSegmentosFile?: string;
  /** Telemetria de atencao da seguranca (Fase 3). */
  atencaoFile?: string;
  /** Diretorio dos bytes de video. Padrao: `videos/` ao lado do log. */
  videosDir?: string;
  /** Teto por arquivo de video. Padrao: `VIDEO_MAX_BYTES`. */
  videoMaxBytes?: number;
  /** Retencao por idade em ms (0 desativa). Padrao: `VIDEO_RETENCAO_MS`. */
  videoRetencaoMs?: number;
  /** Numero maximo de arquivos (0 desativa). Padrao: `VIDEO_MAX_ARQUIVOS`. */
  videoMaxArquivos?: number;
  /** Instancia pronta (startup aplica retencao antes de abrir a porta). */
  armazenadorVideos?: ArmazenadorVideos;
  /** Indice da referencia do ambiente. Padrao: `cena-referencias.jsonl`. */
  cenaReferenciasFile?: string;
  /** Linha do tempo de mudancas da cena. Padrao: `cena-mudancas.jsonl`. */
  cenaMudancasFile?: string;
  /** Diretorio dos pesos NSFW experimentais. Padrao: `modelos/yolonsfw/` na raiz. */
  nsfwDir?: string;
  /** Diretorio das bibliotecas do modo offline. Padrao: `vendor/` na raiz. */
  vendorDir?: string;
  /** Diretorio dos pesos do modo offline. Padrao: `modelos/` na raiz. */
  modelosDir?: string;
}
