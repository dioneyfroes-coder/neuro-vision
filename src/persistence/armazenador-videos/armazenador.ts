import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { VideoSegment } from "../../domain";
import { selecionarParaRetencao } from "../../domain/retencao-videos";
import { ErroCifragemVideo, type CifradorVideo } from "../criptografia-video";
import {
  ArquivoVideoError,
  MAX_BYTES_PADRAO,
  contentTypeValido,
  idSeguro,
  instanteValido,
} from "./tipos";
import type {
  ArquivoVideoSegmento,
  DadosUploadVideo,
  OpcoesArmazenadorVideos,
  ResultadoAplicacaoRetencao,
  VideoArmazenado,
} from "./tipos";

export class ArmazenadorVideos {
  private readonly dir: string;
  private readonly maxBytesPorArquivo: number;
  private readonly retencaoMs: number;
  private readonly maxArquivos: number;
  private readonly maxBytesTotais: number;
  private readonly preservarSegmentoIds: readonly string[];
  private readonly cifrador: CifradorVideo | undefined;

  constructor(opcoes: OpcoesArmazenadorVideos) {
    this.dir = opcoes.dir;
    this.maxBytesPorArquivo = opcoes.maxBytesPorArquivo ?? MAX_BYTES_PADRAO;
    this.retencaoMs = opcoes.retencaoMs ?? 0;
    this.maxArquivos = opcoes.maxArquivos ?? 0;
    this.maxBytesTotais = opcoes.maxBytesTotais ?? 0;
    this.preservarSegmentoIds = opcoes.preservarSegmentoIds ?? [];
    this.cifrador = opcoes.cifrador;
    if (!Number.isFinite(this.maxBytesTotais) || this.maxBytesTotais < 0) {
      throw new Error("maxBytesTotais deve ser finito e nao negativo");
    }
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
    const cifrado = this.cifrador?.id ?? null;
    if (anterior) {
      if (anterior.bytes === dados.bytes.length && (anterior.cifrado ?? null) === cifrado) {
        return anterior;
      }
      throw new ArquivoVideoError(
        "conflito",
        "Segmento ja foi gravado com tamanho ou cifragem diferente"
      );
    }

    const bytesGravados = this.cifrador
      ? this.cifrador.cifrar(Buffer.from(dados.bytes))
      : Buffer.from(dados.bytes);
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
      cifrado,
    };

    const sufixo = randomUUID();
    const tmpVideo = `${video}.tmp-${sufixo}`;
    const tmpMeta = `${meta}.tmp-${sufixo}`;
    try {
      await fs.promises.writeFile(tmpVideo, bytesGravados);
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
    if (arquivo.cifrado) {
      if (!this.cifrador || this.cifrador.id !== arquivo.cifrado) {
        throw new ArquivoVideoError(
          "cifragem_indisponivel",
          `Video cifrado com ${arquivo.cifrado}; chave/esquema indisponivel`
        );
      }
      try {
        bytes = this.cifrador.decifrar(bytes);
      } catch (erro) {
        if (erro instanceof ErroCifragemVideo) {
          throw new ArquivoVideoError("cifragem_invalida", erro.message);
        }
        throw erro;
      }
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
    return (await this.aplicarPoliticaRetencao(agoraMs)).removidos;
  }

  /** Versão auditável da retenção: inclui motivos e IDs preservados. */
  async aplicarPoliticaRetencao(agoraMs: number): Promise<ResultadoAplicacaoRetencao> {
    if (!instanteValido(agoraMs)) throw new Error("agoraMs deve ser finito");
    const arquivos = await this.listar();
    const selecao = selecionarParaRetencao(
      arquivos.map((arquivo) => ({
        segmentoId: arquivo.segmentoId,
        criadoEmMs: arquivo.criadoEmMs,
        bytes: arquivo.bytes,
      })),
      {
        maxIdadeMs: this.retencaoMs,
        maxArquivos: this.maxArquivos,
        maxBytesTotais: this.maxBytesTotais,
        preservarSegmentoIds: this.preservarSegmentoIds,
      },
      agoraMs
    );
    const porId = new Map(arquivos.map((arquivo) => [arquivo.segmentoId, arquivo]));
    const removidos: ArquivoVideoSegmento[] = [];
    for (const alvo of selecao.remover) {
      const arquivo = porId.get(alvo.segmentoId);
      if (!arquivo) continue;
      await this.remover(arquivo);
      removidos.push(arquivo);
    }
    return {
      removidos,
      preservados: selecao.preservados,
      motivos: selecao.motivos,
    };
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
