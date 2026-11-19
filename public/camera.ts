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

const RETENTATIVAS_PADRAO = [500, 1_000, 2_000] as const;

/**
 * Controle da webcam: captura o stream, expoe o tamanho atual do video e gera
 * frames como data URL (JPEG) para envio ao servidor ou exibicao como thumbnail.
 *
 * A queda de uma trilha nao encerra a sessao de gravacao: a camera avisa a
 * interface, que suspende os metadados de captura e tenta reconectar. Quando o
 * sinal volta, o proximo quadro registra a lacuna real no indice do servidor.
 */
export class Camera {
  private readonly opcoes: OpcoesCamera;
  private stream: MediaStream | null = null;
  private readonly frameCanvas: HTMLCanvasElement;
  private readonly frameCtx: CanvasRenderingContext2D | null;
  private readonly thumbCanvas: HTMLCanvasElement;
  private assinaturaCanvas: HTMLCanvasElement | null = null;
  private removerOuvintes: Array<() => void> = [];
  private agendamento: number | null = null;
  private reconectando = false;
  private parada = false;
  private sinalComprometido = false;

  aoQueda?: (motivo: MotivoQuedaCamera) => void;
  aoRetorno?: (motivo: MotivoRetornoCamera) => void;

  constructor(
    private readonly video: HTMLVideoElement,
    opcoes: OpcoesCamera = {}
  ) {
    this.opcoes = opcoes;
    const criarCanvas = opcoes.criarCanvas ?? (() => document.createElement("canvas"));
    this.frameCanvas = criarCanvas();
    this.thumbCanvas = criarCanvas();
    this.frameCtx = this.frameCanvas.getContext("2d");
    this.aoQueda = opcoes.aoQueda;
    this.aoRetorno = opcoes.aoRetorno;
  }

  /** Ha um stream ativo associado ao elemento de video. */
  get ativa(): boolean {
    if (!this.stream) return false;
    const trilhas = this.stream.getTracks();
    return trilhas.length === 0 || trilhas.some((trilha) => trilha.readyState !== "ended");
  }

  /**
   * Stream bruto usado pelo elemento `<video>` e pelo `MediaRecorder`.
   * É o **mesmo** objeto atribuído a `video.srcObject`: parar as trilhas em
   * `encerrar()` invalida também a gravação. `null` quando a câmera não foi
   * iniciada.
   */
  obterStream(): MediaStream | null {
    return this.stream;
  }

  get largura(): number {
    return this.video.videoWidth;
  }

  get altura(): number {
    return this.video.videoHeight;
  }

  /** Solicita a webcam e inicia a reproducao no elemento de video. */
  async iniciar(): Promise<void> {
    this.parada = false;
    this.cancelarReconexao();
    let capturado: MediaStream;
    try {
      capturado = await this.adquirir();
    } catch (err) {
      throw new ErroCamera("acesso", err as Error);
    }
    try {
      await this.atribuir(capturado);
    } catch (err) {
      capturado.getTracks().forEach((trilha) => trilha.stop());
      throw new ErroCamera("video", err as Error);
    }
  }

  /** Para as trilhas e desassocia o stream do elemento de video. */
  encerrar(): void {
    this.parada = true;
    this.cancelarReconexao();
    if (this.stream) {
      this.stream.getTracks().forEach((trilha) => trilha.stop());
      this.stream = null;
    }
    this.removerOuvintes.splice(0).forEach((remover) => remover());
    this.sinalComprometido = false;
    this.video.srcObject = null;
  }

  /**
   * Captura o frame atual como data URL JPEG. `maxWidth` limita a largura
   * (0 mantem o tamanho original); `qualidade` (0..1) limita o tamanho do
   * payload guardado em memoria. Retorna null se o video ainda nao tem frame.
   */
  capturarFrame(maxWidth = 0, qualidade = 0.85): string | null {
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    if (!vw || !vh || !this.frameCtx) return null;

    const escala = maxWidth > 0 && vw > maxWidth ? maxWidth / vw : 1;
    const w = Math.round(vw * escala);
    const h = Math.round(vh * escala);
    this.frameCanvas.width = w;
    this.frameCanvas.height = h;
    this.frameCtx.drawImage(this.video, 0, 0, w, h);
    return this.frameCanvas.toDataURL("image/jpeg", qualidade);
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
    larguraThumb = 240,
    qualidade = 0.85
  ): { imagem: string; thumb: string } | null {
    const imagem = this.capturarFrame(maxWidth, qualidade);
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
    return { imagem, thumb: this.thumbCanvas.toDataURL("image/jpeg", qualidade) };
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

  private adquirir(): Promise<MediaStream> {
    if (this.opcoes.getUserMedia) return this.opcoes.getUserMedia();
    return navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 720 },
    });
  }

  /** Atribui um stream novo e passa a observar seus eventos de disponibilidade. */
  private async atribuir(stream: MediaStream): Promise<void> {
    const anterior = this.stream;
    this.stream = stream;
    this.sinalComprometido = false;
    this.removerOuvintes.splice(0).forEach((remover) => remover());
    this.video.srcObject = stream;
    this.escutar(stream);
    try {
      await this.video.play();
    } catch (err) {
      if (this.stream === stream) {
        stream.getTracks().forEach((trilha) => trilha.stop());
        this.stream = null;
        this.video.srcObject = null;
        this.removerOuvintes.splice(0).forEach((remover) => remover());
      }
      throw err;
    }
    if (anterior && anterior !== stream) {
      anterior.getTracks().forEach((trilha) => trilha.stop());
    }
  }

  private escutar(stream: MediaStream): void {
    const quedas: Array<[string, MotivoQuedaCamera]> = [
      ["ended", "trilha_encerrada"],
      ["mute", "sem_sinal"],
    ];
    for (const trilha of stream.getTracks()) {
      if (trilha.kind && trilha.kind !== "video") continue;
      for (const [evento, motivo] of quedas) {
        const ouvinte = () => this.tratarQueda(motivo);
        trilha.addEventListener?.(evento, ouvinte);
        this.removerOuvintes.push(() => trilha.removeEventListener?.(evento, ouvinte));
      }
      const voltou = () => {
        if (!this.stream || !this.sinalComprometido) return;
        this.sinalComprometido = false;
        this.aoRetorno?.("sinal");
      };
      trilha.addEventListener?.("unmute", voltou);
      this.removerOuvintes.push(() => trilha.removeEventListener?.("unmute", voltou));
    }

    for (const [evento, motivo] of [
      ["error", "video_erro"],
      ["ended", "video_encerrado"],
    ] as const) {
      const ouvinte = () => this.tratarQueda(motivo);
      this.video.addEventListener(evento, ouvinte);
      this.removerOuvintes.push(() => this.video.removeEventListener(evento, ouvinte));
    }
  }

  private tratarQueda(motivo: MotivoQuedaCamera): void {
    if (!this.stream || this.sinalComprometido || this.parada) return;
    this.sinalComprometido = true;
    this.aoQueda?.(motivo);
    if (
      motivo === "trilha_encerrada" ||
      motivo === "video_erro" ||
      motivo === "video_encerrado"
    ) {
      this.agendarReconexao();
    }
  }

  /** Tenta reabrir a camera com backoff limitado; nao usa relogio de parede. */
  private agendarReconexao(): void {
    if (this.parada || this.reconectando || this.agendamento !== null) return;
    const tentativas = this.opcoes.retentativasMs ?? RETENTATIVAS_PADRAO;
    const agendar = this.opcoes.agendar ?? ((cb: () => void, ms: number) => window.setTimeout(cb, ms));
    let indice = 0;

    const tentar = async (): Promise<void> => {
      if (this.parada) return;
      this.reconectando = true;
      try {
        const stream = await this.adquirir();
        await this.atribuir(stream);
        this.aoRetorno?.("reconexao");
      } catch {
        this.aoQueda?.("reconexao_falhou");
        indice += 1;
        if (!this.parada && indice < tentativas.length) {
          this.agendamento = agendar(() => {
            this.agendamento = null;
            return tentar();
          }, tentativas[indice]);
        }
      } finally {
        this.reconectando = false;
      }
    };

    this.agendamento = agendar(() => {
      this.agendamento = null;
      return tentar();
    }, tentativas[0] ?? 0);
  }

  private cancelarReconexao(): void {
    if (this.agendamento !== null) {
      const cancelar =
        this.opcoes.cancelarAgendamento ?? ((id: number) => window.clearTimeout(id));
      cancelar(this.agendamento);
      this.agendamento = null;
    }
  }
}
