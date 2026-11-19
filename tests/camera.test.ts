import { describe, expect, it } from "vitest";
import { Camera, ErroCamera, type MotivoQuedaCamera, type MotivoRetornoCamera } from "../public/camera";

/**
 * Fase 6: queda e retorno da camera sem relogio, DOM ou getUserMedia reais.
 * Todos os eventos sao disparados manualmente nas fontes falsas.
 */

class OuvintesFalsos {
  private readonly ouvintes = new Map<string, Set<() => void>>();

  addEventListener(tipo: string, ouvinte: () => void): void {
    const lista = this.ouvintes.get(tipo) ?? new Set<() => void>();
    lista.add(ouvinte);
    this.ouvintes.set(tipo, lista);
  }

  removeEventListener(tipo: string, ouvinte: () => void): void {
    this.ouvintes.get(tipo)?.delete(ouvinte);
  }

  disparar(tipo: string): void {
    for (const ouvinte of [...(this.ouvintes.get(tipo) ?? [])]) ouvinte();
  }
}

class TrilhaFalsa extends OuvintesFalsos {
  readonly kind = "video";
  readyState: MediaStreamTrackState = "live";
  muted = false;

  stop(): void {
    this.readyState = "ended";
  }
}

interface StreamFalso {
  trilhas: TrilhaFalsa[];
  getTracks(): TrilhaFalsa[];
}

function streamFalso(): StreamFalso {
  const trilhas = [new TrilhaFalsa()];
  return { trilhas, getTracks: () => trilhas };
}

class VideoFalso extends OuvintesFalsos {
  srcObject: MediaStream | null = null;
  videoWidth = 0;
  videoHeight = 0;

  async play(): Promise<void> {}
}

function canvasFalso(): HTMLCanvasElement {
  return {
    width: 0,
    height: 0,
    getContext: () => null,
    toDataURL: () => "",
  } as unknown as HTMLCanvasElement;
}

interface Agendado {
  id: number;
  callback: () => void | Promise<void>;
  ms: number;
}

function criarCamera( streams: StreamFalso[], opcoes: {
  retentativasMs?: readonly number[];
  /** Falha nas N primeiras chamadas (teste de acesso). */
  falharAte?: number;
  /** Falha nas chamadas depois da N-esima (teste de reconexao). */
  falharApos?: number;
} = {}) {
  const video = new VideoFalso();
  const quedas: MotivoQuedaCamera[] = [];
  const retornos: MotivoRetornoCamera[] = [];
  const agendados: Agendado[] = [];
  let proximoId = 1;
  let tentativas = 0;
  const erros: Error[] = [];

  const camera = new Camera(video as unknown as HTMLVideoElement, {
    criarCanvas: canvasFalso,
    retentativasMs: opcoes.retentativasMs ?? [100, 200],
    aoQueda: (motivo) => quedas.push(motivo),
    aoRetorno: (motivo) => retornos.push(motivo),
    getUserMedia: async () => {
      tentativas += 1;
      if (
        (opcoes.falharAte !== undefined && tentativas <= opcoes.falharAte) ||
        (opcoes.falharApos !== undefined && tentativas > opcoes.falharApos)
      ) {
        throw new Error("camera indisponivel");
      }
      const stream = streams[tentativas - 1] ?? streams.at(-1);
      if (!stream) throw new Error("sem stream");
      return stream as unknown as MediaStream;
    },
    agendar: (callback, ms) => {
      const id = proximoId++;
      agendados.push({ id, callback, ms });
      return id;
    },
    cancelarAgendamento: (id) => {
      const indice = agendados.findIndex((item) => item.id === id);
      if (indice >= 0) agendados.splice(indice, 1);
    },
  });

  return {
    camera,
    video,
    quedas,
    retornos,
    agendados,
    tentativas: () => tentativas,
    erros,
    async escoar(): Promise<void> {
      while (agendados.length > 0) {
        const proximo = agendados.shift();
        await proximo?.callback();
      }
    },
  };
}

describe("Camera — disponibilidade de sinal (Fase 6)", () => {
  it("reporta falha de acesso com a fase correta", async () => {
    const h = criarCamera([], { falharAte: 1 });
    await expect(h.camera.iniciar()).rejects.toBeInstanceOf(ErroCamera);
    await expect(h.camera.iniciar()).rejects.toMatchObject({ fase: "acesso" });
    expect(h.camera.ativa).toBe(false);
  });

  it("perde a trilha, agenda reconexao e retoma com um stream novo", async () => {
    const primeiro = streamFalso();
    const segundo = streamFalso();
    const h = criarCamera([primeiro, segundo]);
    await h.camera.iniciar();
    expect(h.camera.obterStream()).toBe(primeiro as unknown as MediaStream);

    primeiro.trilhas[0].readyState = "ended";
    primeiro.trilhas[0].disparar("ended");

    expect(h.quedas).toEqual(["trilha_encerrada"]);
    expect(h.camera.ativa).toBe(false);
    expect(h.agendados).toHaveLength(1);
    expect(h.agendados[0].ms).toBe(100);

    await h.escoar();

    expect(h.tentativas()).toBe(2);
    expect(h.retornos).toEqual(["reconexao"]);
    expect(h.camera.ativa).toBe(true);
    expect(h.camera.obterStream()).toBe(segundo as unknown as MediaStream);
    expect(primeiro.trilhas[0].readyState).toBe("ended");
  });

  it("sem sinal nao reconecta; unmute devolve o mesmo stream", async () => {
    const stream = streamFalso();
    const h = criarCamera([stream]);
    await h.camera.iniciar();

    stream.trilhas[0].disparar("mute");
    expect(h.quedas).toEqual(["sem_sinal"]);
    expect(h.agendados).toEqual([]);

    stream.trilhas[0].muted = false;
    stream.trilhas[0].disparar("unmute");
    expect(h.retornos).toEqual(["sinal"]);
    expect(h.camera.obterStream()).toBe(stream as unknown as MediaStream);
  });

  it("para de tentar apos esgotar as retentativas", async () => {
    const stream = streamFalso();
    const h = criarCamera([stream], { falharApos: 1, retentativasMs: [10, 20] });
    await h.camera.iniciar();

    stream.trilhas[0].disparar("ended");
    await h.escoar();

    expect(h.tentativas()).toBe(3);
    expect(h.quedas).toEqual([
      "trilha_encerrada",
      "reconexao_falhou",
      "reconexao_falhou",
    ]);
    expect(h.agendados).toEqual([]);
  });

  it("cancela a reconexao pendente ao encerrar", async () => {
    const stream = streamFalso();
    const h = criarCamera([stream], { retentativasMs: [10, 20] });
    await h.camera.iniciar();

    stream.trilhas[0].disparar("ended");
    expect(h.agendados).toHaveLength(1);
    h.camera.encerrar();

    expect(h.agendados).toEqual([]);
    await h.escoar();
    expect(h.tentativas()).toBe(1);
  });
});
