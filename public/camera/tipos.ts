import { ErroPercepcao } from "../../src/erros";

/**
 * Erro de inicializacao da camera, com a fase que falhou, para mensagens
 * distintas na interface.
 */
export class ErroCamera extends ErroPercepcao {
  constructor(
    public readonly fase: "acesso" | "video",
    cause: Error
  ) {
    super("camera", cause.message, { cause });
    this.name = "ErroCamera";
  }
}

/** Por que a camera deixou de fornecer sinal utilis. */
export type MotivoQuedaCamera =
  | "trilha_encerrada"
  | "sem_sinal"
  | "video_erro"
  | "video_encerrado"
  | "reconexao_falhou";

/** Como o sinal voltou (mesma trilha ou nova solicitada). */
export type MotivoRetornoCamera = "sinal" | "reconexao";

/** Callbacks de disponibilidade; atribuidos pela interface apos a construcao. */
export interface EventosCamera {
  aoQueda?: (motivo: MotivoQuedaCamera) => void;
  aoRetorno?: (motivo: MotivoRetornoCamera) => void;
}

/**
 * Fontes e agendadores injetaveis. Em producao, `getUserMedia` vem de
 * `navigator.mediaDevices` e `agendar` de `setTimeout`; nos testes, ambos sao
 * falsos e nenhum relogio de parede e necessario.
 */
export interface OpcoesCamera extends EventosCamera {
  getUserMedia?: () => Promise<MediaStream>;
  agendar?: (callback: () => void, ms: number) => number;
  cancelarAgendamento?: (id: number) => void;
  /** Fabrica de canvas; injetada nos testes por nao haver DOM em Node. */
  criarCanvas?: () => HTMLCanvasElement;
  /** Tentativas de reconexao apos perda definitiva da trilha. */
  retentativasMs?: readonly number[];
}

export const RETENTATIVAS_PADRAO = [500, 1_000, 2_000] as const;
