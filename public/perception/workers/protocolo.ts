/**
 * Protocolo RPC entre a thread principal e os workers dedicados de percepcao.
 *
 * Cada worker expoe um ou mais "motores" (deteccao, nsfw, pose, maos). As
 * mensagens sao serializaveis (strings/booleanos/objetos simples): o frame vai
 * como data URL - o worker decodifica em `ImageBitmap`/`OffscreenCanvas`, o que
 * mantem a thread principal livre da inferencia.
 */

/** Motores atendidos pelos workers. */
export type MotorWorker = "deteccao" | "nsfw" | "pose" | "maos";

export interface RequisicaoCarregar {
  id: number;
  tipo: "carregar";
  motor: MotorWorker;
  modelo: string;
}

export interface RequisicaoExecutar {
  id: number;
  tipo: "executar";
  motor: MotorWorker;
  imagem: string;
  threshold?: number;
  percentage?: boolean;
}

export interface RequisicaoEncerrar {
  id: number;
  tipo: "encerrar";
  motor: MotorWorker;
}

export type RequisicaoWorker = RequisicaoCarregar | RequisicaoExecutar | RequisicaoEncerrar;

/** Metadados devolvidos por `carregar` (telemetria do adaptador). */
export interface InfoCargaWorker {
  modelo: string | null;
  dispositivo: string | null;
  versao?: string;
  tempoCargaMs: number | null;
}

export type RespostaWorker =
  | { id: number; ok: true; valor: unknown }
  | { id: number; ok: false; erro: string }
  | { tipo: "status"; motor: MotorWorker; mensagem: string };

/** Corpo de requisicao sem o `id` (atribuido pelo cliente). */
export type CorpoRequisicao =
  | Omit<RequisicaoCarregar, "id">
  | Omit<RequisicaoExecutar, "id">
  | Omit<RequisicaoEncerrar, "id">;

/** Escopo minimo de um `DedicatedWorkerGlobalScope` (evita depender de lib webworker). */
export interface EscopoWorker {
  postMessage(mensagem: RespostaWorker): void;
  onmessage: ((evento: MessageEvent<RequisicaoWorker>) => void) | null;
}
