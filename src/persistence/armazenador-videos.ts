/**
 * Armazenamento dos bytes de vídeo dos segmentos de monitoramento (Fase 3).
 *
 * O índice JSONL descreve cobertura e lacunas; este módulo guarda o conteúdo do
 * vídeo em arquivos separados. Cada segmento fechado vira um par
 * `<segmentoId>.video` + `<segmentoId>.json` (metadados), escrito de forma
 * atômica: o arquivo temporário só é renomeado depois que os dois foram
 * gravados. Um metadado sem arquivo de vídeo (ou um arquivo órfão) nunca é
 * anunciado como cobertura.
 *
 * Nenhuma função lê o relógio: `criadoEmMs` e `agoraMs` são informados por quem
 * chama. Assim a retenção é determinística em teste e em produção.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { VideoSegment } from "../domain";

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
}

export type MotivoErroVideo =
  | "id_invalido"
  | "segmento_aberto"
  | "segmento_invalido"
  | "bytes_invalidos"
  | "bytes_acima_do_limite"
  | "formato_invalido"
  | "conflito"
  | "nao_encontrado";

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
const MAX_BYTES_PADRAO = 200 * 1024 * 1024;

function instanteValido(ms: number): boolean {
  return Number.isFinite(ms) && Math.abs(ms) <= 8.64e15;
}

function idSeguro(id: string, nome: string): string {
  if (typeof id !== "string" || !ID_SEGURO.test(id)) {
    throw new ArquivoVideoError("id_invalido", `${nome} deve usar apenas letras, digitos, _ e -`);
  }
  return id;
}

function contentTypeValido(contentType: string): string {
  const base = typeof contentType === "string" ? contentType.split(";")[0].trim().toLowerCase() : "";
  if (!TIPOS_ACEITOS.has(base)) {
    throw new ArquivoVideoError(
      "formato_invalido",
      "contentType deve ser video/webm, video/mp4 ou video/ogg"
    );
  }
  return base;
}

export class ArmazenadorVideos {
  private readonly dir: string;
  private readonly maxBytesPorArquivo: number;
  private readonly retencaoMs: number;
  private readonly maxArquivos: number;

  constructor(opcoes: OpcoesArmazenadorVideos) {
    this.dir = opcoes.dir;
    this.maxBytesPorArquivo = opcoes.maxBytesPorArquivo ?? MAX_BYTES_PADRAO;
    this.retencaoMs = opcoes.retencaoMs ?? 0;
    this.maxArquivos = opcoes.maxArquivos ?? 0;
    if (!instanteValido(this.retencaoMs) || this.retencaoMs < 0) {
      throw new Error("retencaoMs deve ser finito e nao negativo");
    }
    if (!Number.isFinite(this.maxArquivos) || this.maxArquivos < 0) {
      throw new Error("maxArquivos deve ser finito e nao negativo");
    }
    if (!Number.isFinite(this.maxBytesPorArquivo) || this.maxBytesPorArquivo <= 0) {
      throw new Error("maxBytesPorArquivo deve ser finito e maior que zero");
    }
  }

  /**
   * Guarda os bytes de um segmento **fechado**. Reenvio do mesmo segmento com o
   * mesmo tamanho é idempotente (importante quando o cliente repete o upload
   * após uma falha de rede); com tamanho diferente, é conflito.
   */
  async guardar(
    segmento: VideoSegment,
    dados: DadosUploadVideo
  ): Promise<ArquivoVideoSegmento> {
    idSeguro(segmento.sessaoId, "sessaoId");
    idSeguro(segmento.segmentoId, "segmentoId");
    if (segmento.estado === "gravando") {
      throw new ArquivoVideoError(
        "segmento_aberto",
        "So e possivel guardar um segmento fechado ou incompleto"
      );
    }
    if (
      !instanteValido(segmento.inicioMs) ||
      !instanteValido(segmento.fimMs) ||
      segmento.fimMs < segmento.inicioMs ||
      !Number.isFinite(segmento.quadros) ||
      segmento.quadros < 0
    ) {
      throw new ArquivoVideoError("segmento_invalido", "Segmento com timestamps invalidos");
    }
    if (!(dados.bytes instanceof Uint8Array) || dados.bytes.length === 0) {
      throw new ArquivoVideoError("bytes_invalidos", "Nenhum byte de video recebido");
    }
    if (dados.bytes.length > this.maxBytesPorArquivo) {
      throw new ArquivoVideoError(
        "bytes_acima_do_limite",
        `Video excede o limite de ${this.maxBytesPorArquivo} bytes`
      );
    }
    const contentType = contentTypeValido(dados.contentType);
    if (!instanteValido(dados.criadoEmMs)) {
      throw new ArquivoVideoError("bytes_invalidos", "criadoEmMs deve ser finito");
    }

    await fs.promises.mkdir(this.dir, { recursive: true });
    const { video, meta } = this.caminhos(segmento.segmentoId);
    const anterior = await this.lerMetadados(segmento.segmentoId);
    if (anterior) {
      if (anterior.bytes === dados.bytes.length) return anterior;
      throw new ArquivoVideoError(
        "conflito",
        "Segmento ja foi gravado com tamanho diferente"
      );
    }

    const arquivo: ArquivoVideoSegmento = {
      segmentoId: segmento.segmentoId,
      sessaoId: segmento.sessaoId,
      nomeArquivo: path.basename(video),
      contentType,
      bytes: dados.bytes.length,
      criadoEmMs: dados.criadoEmMs,
      inicioMs: segmento.inicioMs,
      fimMs: segmento.fimMs,
      estado: segmento.estado,
      ...(segmento.motivoFim ? { motivoFim: segmento.motivoFim } : {}),
      quadros: segmento.quadros,
    };

    const sufixo = randomUUID();
    const tmpVideo = `${video}.tmp-${sufixo}`;
    const tmpMeta = `${meta}.tmp-${sufixo}`;
    try {
      await fs.promises.writeFile(tmpVideo, dados.bytes);
      await fs.promises.writeFile(tmpMeta, JSON.stringify(arquivo), "utf8");
      await fs.promises.rename(tmpVideo, video);
      try {
        await fs.promises.rename(tmpMeta, meta);
      } catch (erro) {
        await fs.promises.unlink(video).catch(() => {});
        throw erro;
      }
    } catch (erro) {
      await Promise.all([
        fs.promises.unlink(tmpVideo).catch(() => {}),
        fs.promises.unlink(tmpMeta).catch(() => {}),
      ]);
      throw erro;
    }
    return arquivo;
  }

  /** Bytes e metadados de um segmento, ou `null` quando não estão completos. */
  async obter(segmentoId: string): Promise<VideoArmazenado | null> {
    idSeguro(segmentoId, "segmentoId");
    const arquivo = await this.lerMetadados(segmentoId);
    if (!arquivo) return null;
    const { video } = this.caminhos(segmentoId);
    let bytes: Buffer;
    try {
      bytes = await fs.promises.readFile(video);
    } catch (erro) {
      if ((erro as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw erro;
    }
    return { arquivo, bytes };
  }

  /** Metadados completos, opcionalmente filtrados por sessão. */
  async listar(sessaoId?: string): Promise<ArquivoVideoSegmento[]> {
    let nomes: string[];
    try {
      nomes = await fs.promises.readdir(this.dir);
    } catch (erro) {
      if ((erro as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw erro;
    }
    const arquivos: ArquivoVideoSegmento[] = [];
    for (const nome of nomes) {
      if (!nome.endsWith(".json")) continue;
      const segmentoId = nome.slice(0, -".json".length);
      const arquivo = await this.lerMetadados(segmentoId);
      if (!arquivo) continue;
      if (sessaoId !== undefined && arquivo.sessaoId !== sessaoId) continue;
      const { video } = this.caminhos(segmentoId);
      if (!(await this.existe(video))) continue;
      arquivos.push(arquivo);
    }
    return arquivos.sort(
      (a, b) => a.inicioMs - b.inicioMs || a.segmentoId.localeCompare(b.segmentoId)
    );
  }

  /**
   * Aplica a política de retenção e devolve os metadados removidos. A idade é
   * contada a partir de `criadoEmMs`, nunca do relógio interno.
   */
  async aplicarRetencao(agoraMs: number): Promise<ArquivoVideoSegmento[]> {
    if (!instanteValido(agoraMs)) throw new Error("agoraMs deve ser finito");
    const arquivos = await this.listar();
    const porIdade = arquivos.filter(
      (arquivo) => this.retencaoMs > 0 && arquivo.criadoEmMs + this.retencaoMs <= agoraMs
    );
    const porQuantidade =
      this.maxArquivos > 0
        ? [...arquivos]
            .sort((a, b) => a.criadoEmMs - b.criadoEmMs || a.segmentoId.localeCompare(b.segmentoId))
            .slice(0, Math.max(0, arquivos.length - this.maxArquivos))
        : [];
    const removidos = new Map<string, ArquivoVideoSegmento>();
    for (const arquivo of [...porIdade, ...porQuantidade]) {
      removidos.set(arquivo.segmentoId, arquivo);
    }
    for (const arquivo of removidos.values()) await this.remover(arquivo);
    return [...removidos.values()].sort(
      (a, b) => a.criadoEmMs - b.criadoEmMs || a.segmentoId.localeCompare(b.segmentoId)
    );
  }

  /** Remove um segmento (usado também para atender pedidos de apagar dados). */
  async excluir(segmentoId: string): Promise<boolean> {
    idSeguro(segmentoId, "segmentoId");
    const arquivo = await this.lerMetadados(segmentoId);
    if (!arquivo) return false;
    await this.remover(arquivo);
    return true;
  }

  /** Remove todos os arquivos de uma sessão e devolve os metadados apagados. */
  async excluirSessao(sessaoId: string): Promise<ArquivoVideoSegmento[]> {
    idSeguro(sessaoId, "sessaoId");
    const arquivos = await this.listar(sessaoId);
    for (const arquivo of arquivos) await this.remover(arquivo);
    return arquivos;
  }

  private caminhos(segmentoId: string): { video: string; meta: string } {
    return {
      video: path.join(this.dir, `${segmentoId}.video`),
      meta: path.join(this.dir, `${segmentoId}.json`),
    };
  }

  private async existe(caminho: string): Promise<boolean> {
    try {
      await fs.promises.access(caminho);
      return true;
    } catch {
      return false;
    }
  }

  private async lerMetadados(segmentoId: string): Promise<ArquivoVideoSegmento | null> {
    const { meta } = this.caminhos(segmentoId);
    let texto: string;
    try {
      texto = await fs.promises.readFile(meta, "utf8");
    } catch (erro) {
      if ((erro as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw erro;
    }
    try {
      const valor = JSON.parse(texto) as ArquivoVideoSegmento;
      if (valor?.segmentoId !== segmentoId || typeof valor.bytes !== "number") return null;
      return valor;
    } catch {
      return null;
    }
  }

  private async remover(arquivo: ArquivoVideoSegmento): Promise<void> {
    const { video, meta } = this.caminhos(arquivo.segmentoId);
    await Promise.all([
      fs.promises.unlink(video).catch(() => {}),
      fs.promises.unlink(meta).catch(() => {}),
    ]);
  }
}
