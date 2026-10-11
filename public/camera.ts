import { ErroPercepcao } from "../src/erros";

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

/**
 * Controle da webcam: captura o stream, expoe o tamanho atual do video e gera
 * frames como data URL (JPEG) para envio ao servidor ou exibicao como thumbnail.
 */
export class Camera {
  private stream: MediaStream | null = null;
  private readonly frameCanvas = document.createElement("canvas");
  private readonly frameCtx: CanvasRenderingContext2D | null;

  constructor(private readonly video: HTMLVideoElement) {
    this.frameCtx = this.frameCanvas.getContext("2d");
  }

  /** Ha um stream ativo associado ao elemento de video. */
  get ativa(): boolean {
    return this.stream !== null;
  }

  get largura(): number {
    return this.video.videoWidth;
  }

  get altura(): number {
    return this.video.videoHeight;
  }

  /** Solicita a webcam e inicia a reproducao no elemento de video. */
  async iniciar(): Promise<void> {
    let capturado: MediaStream;
    try {
      capturado = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
      });
    } catch (err) {
      throw new ErroCamera("acesso", err as Error);
    }
    this.stream = capturado;
    this.video.srcObject = capturado;
    try {
      await this.video.play();
    } catch (err) {
      // Sem reproducao nao ha frame; libera a camera antes de propagar.
      this.encerrar();
      throw new ErroCamera("video", err as Error);
    }
  }

  /** Para as trilhas e desassocia o stream do elemento de video. */
  encerrar(): void {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.video.srcObject = null;
  }

  /**
   * Captura o frame atual como data URL JPEG. `maxWidth` limita a largura
   * (0 mantem o tamanho original). Retorna null se o video ainda nao tem frame.
   */
  capturarFrame(maxWidth = 0): string | null {
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    if (!vw || !vh || !this.frameCtx) return null;

    const escala = maxWidth > 0 && vw > maxWidth ? maxWidth / vw : 1;
    const w = Math.round(vw * escala);
    const h = Math.round(vh * escala);
    this.frameCanvas.width = w;
    this.frameCanvas.height = h;
    this.frameCtx.drawImage(this.video, 0, 0, w, h);
    return this.frameCanvas.toDataURL("image/jpeg", 0.85);
  }
}
