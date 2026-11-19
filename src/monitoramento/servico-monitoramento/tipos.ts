import type {
  MotivoRejeicaoQuadro,
  QuadroAtribuido,
  SessaoMonitoramento,
} from "../../domain";
import type { ConfigGerenciadorGravacao } from "../gerenciador-gravacao";

/** Teto de quadros por lote de `enviarQuadros` (2 min a 5 FPS). */
export const MAX_QUADROS_POR_LOTE = 600;

/** Limite padrão de atualizações lidas do índice por consulta. */
export const LIMITE_INDICE_MONITORAMENTO_PADRAO = 2_000;

/** Limite padrão de bytes por arquivo do índice (rotação append-only). */
export const MAX_BYTES_INDICE_MONITORAMENTO_PADRAO = 5_000_000;

export interface ArquivosMonitoramento {
  sessoesFile: string;
  segmentosFile: string;
}

export interface OpcoesServicoMonitoramento extends ArquivosMonitoramento {
  /** Tamanho máximo de cada JSONL antes da rotação. */
  maxBytes?: number;
  /** Configuração padrão repassada ao gerenciador (pode ser sobreposta por sessão). */
  config?: ConfigGerenciadorGravacao;
}

/** Quadro recusado dentro de um lote, sem interromper os demais. */
export interface QuadroRejeitadoNoLote {
  frameId: string;
  motivo: MotivoRejeicaoQuadro;
  erro: string;
}

export interface ResultadoEnvioQuadros {
  sessao: SessaoMonitoramento | null;
  atribuicoes: QuadroAtribuido[];
  rejeitados: QuadroRejeitadoNoLote[];
}

/** Conflito de estado: não é payload inválido, é uma transição impossível agora. */
export class ConflitoMonitoramentoError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ConflitoMonitoramentoError";
  }
}
