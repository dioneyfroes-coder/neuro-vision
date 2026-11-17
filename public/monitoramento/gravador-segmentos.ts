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

/** Fábrica injetada; em produção devolve um `MediaRecorder` nativo. */
export type CriarRecorder = (stream: unknown, mimeType: string) => RecorderLike;

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

  constructor(private readonly opcoes: OpcoesGravadorSegmentos) {}

  get ativo(): boolean {
    return this.recorder !== null;
  }

  get mimeType(): string {
    return this.opcoes.mimeType;
  }

  iniciar(): void {
    if (this.recorder) throw new ErroGravacaoSegmento("Ja ha um segmento em gravacao");
    if (!this.opcoes.mimeType) {
      throw new ErroGravacaoSegmento("Nenhum formato de video suportado pelo navegador");
    }
    const recorder = this.opcoes.criarRecorder(this.opcoes.stream, this.opcoes.mimeType);
    this.pedacos = [];
    recorder.ondataavailable = (evento) => {
      if (evento?.data && evento.data.size > 0) this.pedacos.push(evento.data);
    };
    try {
      recorder.start();
    } catch (err) {
      recorder.ondataavailable = null;
      throw new ErroGravacaoSegmento(`Falha ao iniciar a gravacao: ${(err as Error).message}`);
    }
    this.recorder = recorder;
  }

  /** Encerra o segmento atual e espera o evento `stop` antes de devolver o blob. */
  fechar(): Promise<SegmentoFechado | null> {
    const recorder = this.recorder;
    if (!recorder) return Promise.resolve(null);
    this.recorder = null;
    return new Promise<SegmentoFechado | null>((resolve, reject) => {
      recorder.onerror = () => {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        this.pedacos = [];
        reject(new ErroGravacaoSegmento("Falha ao gravar o segmento"));
      };
      recorder.onstop = () => {
        recorder.ondataavailable = null;
        recorder.onerror = null;
        const pedacos = this.pedacos;
        this.pedacos = [];
        const bytes = new Blob(pedacos, { type: this.opcoes.mimeType });
        resolve(
          bytes.size > 0
            ? { bytes, contentType: this.opcoes.mimeType, criadoEmMs: this.opcoes.agoraMs() }
            : null
        );
      };
      try {
        recorder.stop();
      } catch (err) {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.onerror = null;
        this.pedacos = [];
        reject(new ErroGravacaoSegmento(`Falha ao fechar a gravacao: ${(err as Error).message}`));
      }
    });
  }
}
