import type {
  DetectorObjetos,
  EntradaAdaptador,
  EstimadorPose,
  MetricasAdaptador,
  OpcoesDeteccao,
  ReconhecedorGestos,
} from "../../public/perception/contracts";
import type {
  ResultadoDeteccaoLocal,
  ResultadoMaos,
  ResultadoOuIndisponivel,
  ResultadoPose,
} from "../../src/domain";
import { indisponivel } from "../../src/domain";
import type { SnapshotCapturado } from "../../public/capture/snapshot-store";
import type { FonteCaptura } from "../../public/capture/webcam-capture";

export function snapshot(frameId = "s-c1-f0"): SnapshotCapturado {
  return Object.freeze({
    frameId,
    imagem: `imagem:${frameId}`,
    capturadoEm: "2026-10-16T10:00:00.000Z",
    capturadoEmMs: 0,
    dimensoes: { largura: 640, altura: 480 },
  });
}

export const DETECCAO: ResultadoDeteccaoLocal = {
  deteccoes: [{ nome: "pessoa", rotulo: "person", score: 0.9, caixa: { xmin: 0, ymin: 0, xmax: 1, ymax: 1 } }],
  dimensoes: { largura: 640, altura: 480 },
};

export const POSE: ResultadoPose = { pessoas: [{ pontos: [{ x: 0.5, y: 0.5, confianca: 0.9 }] }] };
export const MAOS: ResultadoMaos = { maos: [{ lateralidade: "direita", landmarks: [{ x: 0.1, y: 0.1 }] }] };

export class DetectorFalso implements DetectorObjetos {
  readonly id = "objetos";
  readonly metricas: MetricasAdaptador = {};
  readonly modelo = "obj-teste";
  aoStatus?: (mensagem: string) => void;
  /** Ordem de chamadas compartilhada, para provar a sequencia do pipeline. */
  constructor(private readonly ordem: string[] = [], private readonly falhar = false) {}

  carregar(): Promise<void> {
    return Promise.resolve();
  }

  detectar(_entrada: EntradaAdaptador, _opcoes?: OpcoesDeteccao): Promise<ResultadoDeteccaoLocal> {
    this.ordem.push("deteccao");
    if (this.falhar) throw new Error("detector quebrou");
    return Promise.resolve(DETECCAO);
  }

  encerrar(): void {}
}

export class PoseFalso implements EstimadorPose {
  readonly id = "pose";
  readonly metricas: MetricasAdaptador = {};
  readonly modelo = "pose-teste";
  aoStatus?: (mensagem: string) => void;

  constructor(
    private readonly ordem: string[] = [],
    private readonly falhar: "lanca" | "indisponivel" | null = null
  ) {}

  carregar(): Promise<void> {
    return Promise.resolve();
  }

  estimar(): Promise<ResultadoOuIndisponivel<ResultadoPose>> {
    this.ordem.push("pose");
    if (this.falhar === "lanca") throw new Error("pose quebrou");
    if (this.falhar === "indisponivel") return Promise.resolve(indisponivel("pose", "sem pessoas"));
    return Promise.resolve(POSE);
  }

  encerrar(): void {}
}

export class MaosFalso implements ReconhecedorGestos {
  readonly id = "maos";
  readonly metricas: MetricasAdaptador = {};
  readonly modelo = "maos-teste";
  aoStatus?: (mensagem: string) => void;

  constructor(private readonly ordem: string[] = [], private readonly falhar = false) {}

  carregar(): Promise<void> {
    return Promise.resolve();
  }

  reconhecer(): Promise<ResultadoOuIndisponivel<ResultadoMaos>> {
    this.ordem.push("maos");
    if (this.falhar) throw new Error("maos quebrou");
    return Promise.resolve(MAOS);
  }

  encerrar(): void {}
}

export function fonteComImagens(imagens: string[]): FonteCaptura {
  let i = 0;
  return {
    ativa: true,
    largura: 1280,
    altura: 720,
    capturarQuadro: () => {
      const imagem = imagens[i] ?? imagens[imagens.length - 1];
      i += 1;
      return { imagem, thumb: `thumb:${imagem}` };
    },
    assinaturaDeCena: () => [1, 2, 3],
  };
}
