/**
 * Fonte de vídeo em timelapse para gravação de baixo uso de espaço (opção 3).
 *
 * Desenha o `<video>` da câmera em um canvas em baixa taxa (<= 10 fps) e
 * expõe um `MediaStream` via `captureStream`, independente do stream de
 * preview/análise. A gravação fica bem menor (timelapse) ao custo de fluidez.
 */

export interface OpcoesFonteTimelapse {
  /** Quadros por segundo do timelapse (padrão: 2). Valores são limitados a [0.2, 10]. */
  fps?: number;
  /** Largura máxima do quadro gravado (0 = usa dimensão do vídeo). */
  larguraMax?: number;
  /** Altura máxima do quadro gravado (0 = usa dimensão do vídeo). */
  alturaMax?: number;
  /** Fábrica de canvas (injetável para testes/ambientes sem DOM completo). */
  criarCanvas?: () => HTMLCanvasElement;
  /** Agendador injetável. */
  agendarIntervalo?: (fn: () => void, ms: number) => unknown;
  cancelarIntervalo?: (id: unknown) => void;
}

export interface FonteTimelapse {
  stream: MediaStream;
  /** Para o desenho e encerra as trilhas do stream de captura. */
  liberar: () => void;
}

function limitar(valor: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, valor));
}

function dimensoesTimelapse(
  video: HTMLVideoElement,
  larguraMax: number,
  alturaMax: number
): { largura: number; altura: number } {
  const vw = video.videoWidth || 640;
  const vh = video.videoHeight || 480;
  let escala = 1;
  if (larguraMax > 0 && vw > larguraMax) escala = Math.min(escala, larguraMax / vw);
  if (alturaMax > 0 && vh > alturaMax) escala = Math.min(escala, alturaMax / vh);
  return {
    largura: Math.max(2, Math.round(vw * escala)),
    altura: Math.max(2, Math.round(vh * escala)),
  };
}

/**
 * Cria um stream timelapse desenhando o vídeo periodicamente em um canvas.
 * Requer ambiente com `canvas.captureStream` (navegador).
 */
export function criarFonteTimelapse(
  video: HTMLVideoElement,
  opcoes: OpcoesFonteTimelapse = {}
): FonteTimelapse {
  const fps = limitar(opcoes.fps ?? 2, 0.2, 10);
  const larguraMax = opcoes.larguraMax ?? 480;
  const alturaMax = opcoes.alturaMax ?? 360;
  const criarCanvas = opcoes.criarCanvas ?? (() => document.createElement("canvas"));
  const agendar = opcoes.agendarIntervalo ?? ((fn, ms) => window.setInterval(fn, ms));
  const cancelar = opcoes.cancelarIntervalo ?? ((id) => window.clearInterval(id as number));

  const canvas = criarCanvas();
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D indisponivel para gravacao timelapse");
  }
  if (typeof (canvas as HTMLCanvasElement & { captureStream?: unknown }).captureStream !== "function") {
    throw new Error("captureStream indisponivel para gravacao timelapse");
  }

  let liberado = false;
  const desenhar = () => {
    if (liberado) return;
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
    const { largura, altura } = dimensoesTimelapse(video, larguraMax, alturaMax);
    if (canvas.width !== largura) canvas.width = largura;
    if (canvas.height !== altura) canvas.height = altura;
    try {
      ctx.drawImage(video, 0, 0, largura, altura);
    } catch {
      // Frame indisponível momentaneamente (ex.: troca de stream); ignora.
    }
  };

  // Primeiro quadro imediato (quando houver) e então em intervalo fixo.
  desenhar();
  const intervaloMs = Math.max(100, Math.round(1000 / fps));
  const timer = agendar(desenhar, intervaloMs);

  // `captureStream(fps)` sugere a taxa; o desenho periódico garante conteúdo.
  const stream = canvas.captureStream(fps);

  return {
    stream,
    liberar: () => {
      if (liberado) return;
      liberado = true;
      cancelar(timer);
      for (const trilha of stream.getTracks()) {
        try {
          trilha.stop();
        } catch {
          // ignore
        }
      }
    },
  };
}