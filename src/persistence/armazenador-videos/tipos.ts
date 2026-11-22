import type { CifradorVideo } from "../criptografia-video";
import type { VideoSegment } from "../../domain";
import type { MotivosRetencao } from "../../domain/retencao-videos";

/** Metadados duráveis de um arquivo de vídeo. */
export interface ArquivoVideoSegmento {
  segmentoId: string;
  sessaoId: string;
  /** Nome do arquivo de bytes dentro do diretório configurado. */
  nomeArquivo: string;
  contentType: string;
  bytes: number;
  criadoEmMs: number;
  inicioMs: number;
  fimMs: number;
  estado: VideoSegment["estado"];
  motivoFim?: VideoSegment["motivoFim"];
  quadros: number;
  /** Identificador do esquema de cifragem, ou `null` quando gravado em claro. */
  cifrado?: string | null;
}

/** Desfecho da retenção já aplicada, com motivos auditáveis. */
export interface ResultadoAplicacaoRetencao {
  removidos: ArquivoVideoSegmento[];
  preservados: string[];
  motivos: MotivosRetencao;
}

export type MotivoErroVideo =
  | "id_invalido"
  | "segmento_aberto"
  | "segmento_invalido"
  | "bytes_invalidos"
  | "bytes_acima_do_limite"
  | "formato_invalido"
  | "conflito"
  | "nao_encontrado"
  | "cifragem_indisponivel"
  | "cifragem_invalida";

/** Erro explícito: o chamador traduz o motivo em status HTTP. */
export class ArquivoVideoError extends Error {
  constructor(
    readonly motivo: MotivoErroVideo,
    mensagem: string
  ) {
    super(mensagem);
    this.name = "ArquivoVideoError";
  }
}

export interface OpcoesArmazenadorVideos {
  dir: string;
  /** Teto por arquivo. Padrão: 200 MB. */
  maxBytesPorArquivo?: number;
  /** Retenção por idade em ms; `0` desativa. Padrão: `0` (sem expiração). */
  retencaoMs?: number;
  /** Número máximo de arquivos; `0` desativa. Padrão: `0` (ilimitado). */
  maxArquivos?: number;
  /** Total máximo de bytes no diretório; `0` desativa. Padrão: `0`. */
  maxBytesTotais?: number;
  /** Segmentos preservados da retenção (eventos importantes). */
  preservarSegmentoIds?: readonly string[];
  /** Cifragem em repouso dos bytes; ausente = gravação em claro declarada. */
  cifrador?: CifradorVideo;
}

export interface DadosUploadVideo {
  bytes: Uint8Array;
  contentType: string;
  criadoEmMs: number;
}

export interface VideoArmazenado {
  arquivo: ArquivoVideoSegmento;
  bytes: Buffer;
}

/** Tipos aceitos no upload; o parâmetro `codecs` do MediaRecorder é ignorado. */
const TIPOS_ACEITOS = new Set(["video/webm", "video/mp4", "video/ogg"]);
/** Ids são UUIDs/ rótulos seguros; nada de separador de caminho ou `..`. */
const ID_SEGURO = /^[A-Za-z0-9_-]+$/;
export const MAX_BYTES_PADRAO = 200 * 1024 * 1024;

export function instanteValido(ms: number): boolean {
  return Number.isFinite(ms) && Math.abs(ms) <= 8.64e15;
}

export function idSeguro(id: string, nome: string): string {
  if (typeof id !== "string" || !ID_SEGURO.test(id)) {
    throw new ArquivoVideoError("id_invalido", `${nome} deve usar apenas letras, digitos, _ e -`);
  }
  return id;
}

export function contentTypeValido(contentType: string): string {
  const base = typeof contentType === "string" ? contentType.split(";")[0].trim().toLowerCase() : "";
  if (!TIPOS_ACEITOS.has(base)) {
    throw new ArquivoVideoError(
      "formato_invalido",
      "contentType deve ser video/webm, video/mp4 ou video/ogg"
    );
  }
  return base;
}
