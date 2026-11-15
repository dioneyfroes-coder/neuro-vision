/**
 * Contratos do modo Câmera de Segurança (Fase 3).
 *
 * O monitoramento é **independente** do ciclo de snapshots da interface: uma
 * sessão grava continuamente em segmentos de vídeo, enquanto a análise
 * multimodal roda quando pode. Estes tipos descrevem a sessão, os segmentos e
 * as lacunas de gravação; os bytes do vídeo ficam fora do domínio (quem grava
 * decide o formato e o armazenamento).
 */

/** Duração alvo de cada segmento de vídeo (5 minutos), conforme o roteiro. */
export const DURACAO_SEGMENTO_PADRAO_MS = 5 * 60_000;

/**
 * Retenção padrão do buffer circular pré-evento. Guarda alguns segundos antes
 * de um gatilho para que a análise não comece apenas depois da detecção.
 */
export const RETENCAO_PRE_EVENTO_PADRAO_MS = 10_000;

/**
 * Lacuna mínima (ms) entre quadros que deixa de ser jitter de captura e passa a
 * ser falha de gravação. Um intervalo maior fecha o segmento como incompleto e
 * registra a lacuna, em vez de fingir continuidade.
 */
export const LIMIAR_LACUNA_PADRAO_MS = 2_000;

/** Estado da sessão de monitoramento. */
export type EstadoSessaoMonitoramento = "ativa" | "pausada" | "encerrada" | "interrompida";

/** Estado de um segmento de vídeo. */
export type EstadoSegmentoVideo = "gravando" | "fechado" | "incompleto";

/**
 * Por que um segmento terminou.
 *
 * - `duracao`: atingiu a duração alvo e o próximo continua no limite exato;
 * - `sessao_encerrada`/`pausa`: fim intencional, não é falha;
 * - `lacuna`: a gravação ficou sem quadros além do limiar (falha detectada).
 */
export type MotivoFimSegmento = "duracao" | "sessao_encerrada" | "pausa" | "lacuna";

/** Lacuna de gravação registrada dentro de um segmento. */
export interface LacunaGravacao {
  inicioEm: string;
  inicioMs: number;
  fimEm: string;
  fimMs: number;
  duracaoMs: number;
  /** `sem_quadros` quando detectada pela ausência; `falha` quando relatada. */
  motivo: "sem_quadros" | "falha";
}

/** Sessão de monitoramento de um ambiente. */
export interface SessaoMonitoramento {
  sessaoId: string;
  /** Rótulo livre do ambiente (ex.: "sala", "garagem"). Não é identidade civil. */
  ambiente: string;
  iniciadaEm: string;
  iniciadaEmMs: number;
  encerradaEm?: string;
  encerradaEmMs?: number;
  estado: EstadoSessaoMonitoramento;
  /** Duração alvo de cada segmento (padrão: 5 minutos). */
  duracaoSegmentoMs: number;
  /** Retenção do buffer circular pré-evento. */
  retencaoPreEventoMs: number;
  /** Intervalo sem quadros que já conta como lacuna de gravação. */
  limiarLacunaMs: number;
}

/**
 * Segmento de vídeo com timestamps explícitos.
 *
 * A cobertura é o intervalo que o segmento **realmente** representa:
 * `[inicioMs, fimMs)`. Na rotação por duração, `fimMs` é o limite exato e o
 * próximo segmento começa nele — assim nenhum frame fica sem dono e nenhum
 * intervalo é coberto duas vezes. Em pausa, encerramento ou lacuna, `fimMs` é o
 * último quadro gravado: o trecho sem gravação **não** é anunciado como
 * coberto.
 */
export interface VideoSegment {
  segmentoId: string;
  sessaoId: string;
  /** Ordem cronológica dentro da sessão, começando em 1. */
  sequencia: number;
  inicioEm: string;
  inicioMs: number;
  fimEm: string;
  fimMs: number;
  duracaoMs: number;
  /** Quantidade de quadros atribuídos ao segmento. */
  quadros: number;
  estado: EstadoSegmentoVideo;
  motivoFim?: MotivoFimSegmento;
  lacunas: LacunaGravacao[];
}

/** Metadados mínimos de um quadro entregue ao gravador. */
export interface QuadroGravado {
  frameId: string;
  /** Instante de captura em epoch ms. */
  capturadoEmMs: number;
}

/** Resultado da atribuição de um quadro a um segmento. */
export interface QuadroAtribuido {
  frameId: string;
  segmentoId: string;
  sequenciaSegmento: number;
  /** Distância (ms) do início do segmento. */
  offsetMs: number;
}

/** Motivo de rejeição de um quadro pela gravação. */
export type MotivoRejeicaoQuadro =
  | "tempo_invalido"
  | "fora_de_ordem"
  | "sem_sessao"
  | "sessao_pausada"
  | "sessao_encerrada";

/** Erro explícito: um quadro não pode ser atribuído sem inventar cobertura. */
export class QuadroRejeitadoError extends Error {
  constructor(
    readonly motivo: MotivoRejeicaoQuadro,
    mensagem: string
  ) {
    super(mensagem);
    this.name = "QuadroRejeitadoError";
  }
}
