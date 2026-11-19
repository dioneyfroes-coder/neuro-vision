import type { QuadroGravado, SessaoMonitoramento } from "../../../src/domain";
import type { ResultadoQuadrosMonitoramento } from "../../api";
import type { GravadorSegmentos, SegmentoFechado } from "../gravador-segmentos";

/** Superfície HTTP usada pelo controlador (implementada pelo adaptador de `api.ts`). */
export interface ApiMonitoramentoCliente {
  iniciar(opcoes: {
    ambiente: string;
    agoraMs: number;
    duracaoSegmentoMs?: number;
  }): Promise<SessaoMonitoramento>;
  enviarQuadros(quadros: QuadroGravado[]): Promise<ResultadoQuadrosMonitoramento>;
  pausar(sessaoId: string): Promise<SessaoMonitoramento>;
  retomar(sessaoId: string): Promise<SessaoMonitoramento>;
  encerrar(sessaoId: string, agoraMs: number): Promise<SessaoMonitoramento>;
  interromper(
    sessaoId: string,
    agoraMs: number,
    motivo: "falha" | "sem_quadros"
  ): Promise<SessaoMonitoramento>;
  enviarVideo(opcoes: {
    segmentoId: string;
    bytes: Blob;
    contentType: string;
    criadoEmMs: number;
  }): Promise<unknown>;
}

export interface UploadPendente extends SegmentoFechado {
  segmentoId: string;
}

export type EstadoMonitoramento =
  | "parada"
  | "iniciando"
  | "gravando"
  | "pausada"
  | "encerrada"
  | "erro";

export interface DependenciasMonitoramento {
  api: ApiMonitoramentoCliente;
  /** Relógio injetado; em produção, `() => Date.now()`. */
  agoraMs: () => number;
  /** Fábrica de um gravador já configurado com o stream da câmera. */
  criarGravador: () => GravadorSegmentos;
  /**
   * Agendador injetado: devolve uma função que cancela o tick. Em produção usa
   * `setInterval` (ignorando a promessa); nos testes o tick é disparado e
   * aguardado manualmente.
   */
  agendarTick: (tick: () => Promise<void>, periodoMs: number) => () => void;
  /** Intervalo entre relatórios de captura ao índice (padrão: 1000 ms). */
  periodoMs?: number;
  aoEstado?: (estado: EstadoMonitoramento) => void;
  /** Avisa quando o segmento corrente muda (rotação, pausa, encerramento). */
  aoSegmento?: (segmentoId: string | null) => void;
  /** Avisa quando a camera perde/retoma o sinal, sem encerrar a sessao. */
  aoSinal?: (ativo: boolean, motivo?: string) => void;
  aoErro?: (erro: Error) => void;
}
