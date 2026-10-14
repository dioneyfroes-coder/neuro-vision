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
  private readonly thumbCanvas = document.createElement("canvas");
  private assinaturaCanvas: HTMLCanvasElement | null = null;

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

  /**
   * Captura o frame **uma unica vez** e devolve a imagem de analise junto de um
   * thumbnail derivado dos **mesmos pixels** (mesmo instante). Usar isto evita o
   * descompasso em que o snapshot exibido no historico era um segundo frame,
   * capturado depois da inferencia. O thumbnail e apenas uma reducao da imagem
   * analisada, nunca uma nova leitura da camera.
   */
  capturarQuadro(
    maxWidth = 0,
    larguraThumb = 240
  ): { imagem: string; thumb: string } | null {
    const imagem = this.capturarFrame(maxWidth);
    if (imagem === null) return null;

    const largura = this.frameCanvas.width;
    const altura = this.frameCanvas.height;
    const escala = larguraThumb > 0 && largura > larguraThumb ? larguraThumb / largura : 1;
    const w = Math.max(1, Math.round(largura * escala));
    const h = Math.max(1, Math.round(altura * escala));
    const ctx = this.thumbCanvas.getContext("2d");
    if (!ctx) return { imagem, thumb: imagem };

    this.thumbCanvas.width = w;
    this.thumbCanvas.height = h;
    ctx.drawImage(this.frameCanvas, 0, 0, w, h);
    return { imagem, thumb: this.thumbCanvas.toDataURL("image/jpeg", 0.85) };
  }

  /**
   * Assinatura de cena (luminancia media por celula de uma grade) para detectar
   * mudancas amplas. Retorna null se o video ainda nao tem frame ou se os pixels
   * nao estao acessiveis.
   */
  assinaturaDeCena(grade = 8): number[] | null {
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    if (!vw || !vh) return null;
    try {
      if (!this.assinaturaCanvas) this.assinaturaCanvas = document.createElement("canvas");
      const canvas = this.assinaturaCanvas;
      canvas.width = grade;
      canvas.height = grade;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(this.video, 0, 0, grade, grade);
      const dados = ctx.getImageData(0, 0, grade, grade).data;
      const assinatura: number[] = [];
      for (let i = 0; i < dados.length; i += 4) {
        assinatura.push(
          0.2126 * dados[i] + 0.7152 * dados[i + 1] + 0.0722 * dados[i + 2]
        );
      }
      return assinatura;
    } catch {
      return null;
    }
  }
}
