/**
 * Gravador de segmentos do lado do cliente (Fase 3).
 *
 * Esta camada só transforma um `MediaStream` em blobs fechados por segmento. Ela
 * não conhece a API HTTP nem o relógio: o instante de gravação é informado por
 * quem chama, e o `MediaRecorder` é injetado por uma fábrica — assim os testes
 * usam um gravador falso e timestamps sintéticos.
 */

/** Superfície mínima de `MediaRecorder` usada aqui (aceita gravadores falsos). */
export interface RecorderLike {
  readonly state: string;
  readonly mimeType: string;
  start(): void;
  stop(): void;
  ondataavailable: ((evento: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((evento: unknown) => void) | null;
}

/** Opções de criação do recorder nativo (ex.: timelapse com bitrate reduzido). */
export interface OpcoesCriarRecorder {
  videoBitsPerSecond?: number;
}

/** Fábrica injetada; em produção devolve um `MediaRecorder` nativo. */
export type CriarRecorder = (
  stream: unknown,
  mimeType: string,
  opcoes?: OpcoesCriarRecorder
) => RecorderLike;

/** Ordem de preferência: VP9, VP8, WebM sem codec declarado, MP4. */
const MIME_PREFERIDOS = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
  "video/mp4",
];

/**
 * Escolhe o primeiro MIME suportado. A função de suporte é injetada para que o
 * teste não dependa de `MediaRecorder` do navegador.
 */
export function escolherMimeTypeVideo(
  suportado: (mime: string) => boolean = (mime) =>
    typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mime)
): string {
  return MIME_PREFERIDOS.find(suportado) ?? "";
}

export interface OpcoesGravadorSegmentos {
  stream: unknown;
  criarRecorder: CriarRecorder;
  /** Relógio injetado: usado apenas para o `criadoEmMs` do upload. */
  agoraMs: () => number;
  mimeType: string;
  /** Bitrate de vídeo (bps), útil para timelapse/baixo uso de espaço. */
  videoBitsPerSecond?: number;
  /** Libera recursos da fonte de gravação (ex.: canvas/timer de timelapse). */
  liberarFonte?: () => void;
  /** Falha do `MediaRecorder` com segmento ativo (best-effort, sem parar o ciclo). */
  aoErro?: (erro: Error) => void;
}

export interface SegmentoFechado {
  bytes: Blob;
  contentType: string;
  criadoEmMs: number;
}

/** Erro explícito quando o navegador não consegue gravar o segmento. */
export class ErroGravacaoSegmento extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroGravacaoSegmento";
  }
}

/**
 * Um gravador por segmento: `iniciar()` abre, `fechar()` devolve o blob e
 * libera o recorder. Chamar `fechar()` sem segmento ativo devolve `null`.
 */
export class GravadorSegmentos {
  private recorder: RecorderLike | null = null;
  private pedacos: Blob[] = [];
  private falhou = false;
  private fonteLiberada = false;

  constructor(private readonly opcoes: OpcoesGravadorSegmentos) {}

  get ativo(): boolean {
    return this.recorder !== null;
  }

  /** O recorder falhou durante o segmento; o controlador renova no próximo tick. */
  get falhouDuranteGravacao(): boolean {
    return this.falhou;
  }

  get mimeType(): string {
    return this.opcoes.mimeType;
  }

  private liberarFonte(): void {
    if (this.fonteLiberada) return;
    this.fonteLiberada = true;
    try {
      this.opcoes.liberarFonte?.();
    } catch {
      // Best-effort: liberar a fonte não deve mascarar o resultado da gravação.
    }
  }

  iniciar(): void {
    if (this.recorder) throw new ErroGravacaoSegmento("Ja ha um segmento em gravacao");
    if (!this.opcoes.mimeType) {
      this.liberarFonte();
      throw new ErroGravacaoSegmento("Nenhum formato de video suportado pelo navegador");
    }
    const recorder = this.opcoes.criarRecorder(
      this.opcoes.stream,
      this.opcoes.mimeType,
      this.opcoes.videoBitsPerSecond !== undefined
        ? { videoBitsPerSecond: this.opcoes.videoBitsPerSecond }
        : undefined
    );
    this.pedacos = [];
    this.falhou = false;
    recorder.ondataavailable = (evento) => {
      if (evento?.data && evento.data.size > 0) this.pedacos.push(evento.data);
    };
    // Antes, `onerror` so era ligado em `fechar()`: uma falha no meio do
    // segmento passava despercebida e o gravador seguia "ativo" sem bytes.
    recorder.onerror = () => {
      this.falhou = true;
      this.opcoes.aoErro?.(new ErroGravacaoSegmento("Falha do MediaRecorder durante a gravacao"));
    };
    try {
      recorder.start();
    } catch (err) {
      recorder.ondataavailable = null;
      this.liberarFonte();
      throw new ErroGravacaoSegmento(`Falha ao iniciar a gravacao: ${(err as Error).message}`);
    }
    this.recorder = recorder;
  }

  /** Encerra o segmento atual e espera o evento `stop` antes de devolver o blob. */
  fechar(): Promise<SegmentoFechado | null> {
    const recorder = this.recorder;
    if (!recorder) {
      this.liberarFonte();
      return Promise.resolve(null);
    }
    this.recorder = null;
    return new Promise<SegmentoFechado | null>((resolve, reject) => {
      const concluir = () => {
        recorder.ondataavailable = null;
        recorder.onerror = null;
        recorder.onstop = null;
        const pedacos = this.pedacos;
        this.pedacos = [];
        const bytes = new Blob(pedacos, { type: this.opcoes.mimeType });
        this.liberarFonte();
        resolve(
          bytes.size > 0
            ? { bytes, contentType: this.opcoes.mimeType, criadoEmMs: this.opcoes.agoraMs() }
            : null
        );
      };
      recorder.onerror = () => {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        this.pedacos = [];
        this.liberarFonte();
        reject(new ErroGravacaoSegmento("Falha ao gravar o segmento"));
      };
      recorder.onstop = concluir;
      // Um erro ativo pode ter parado o recorder; ainda assim aproveitamos os
      // pedacos recebidos em vez de chamar `stop()` em estado inativo.
      if (recorder.state === "inactive") {
        concluir();
        return;
      }
      try {
        recorder.stop();
      } catch (err) {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.onerror = null;
        this.pedacos = [];
        this.liberarFonte();
        reject(new ErroGravacaoSegmento(`Falha ao fechar a gravacao: ${(err as Error).message}`));
      }
    });
  }
}
