import { describe, expect, it, vi } from "vitest";
import {
  PipelineLocal,
  criarProcessadorFrameLocal,
  criarProcessadorInativo,
} from "../public/perception/local-perception-pipeline";
import type {
  DetectorObjetos,
  EntradaAdaptador,
  EstimadorPose,
  MetricasAdaptador,
  OpcoesDeteccao,
  ReconhecedorGestos,
} from "../public/perception/contracts";
import { estaIndisponivel, indisponivel } from "../src/domain";
import type {
  ResultadoDeteccaoLocal,
  ResultadoMaos,
  ResultadoOuIndisponivel,
  ResultadoPose,
} from "../src/domain";
import type { SnapshotCapturado } from "../public/capture/snapshot-store";
import { executarCicloMultiframe } from "../public/cycle/ciclo-multiframe";
import type { DependenciasCicloMultiframe } from "../public/cycle/ciclo-multiframe";
import { SnapshotStore } from "../public/capture/snapshot-store";
import { CONFIG_CAPTURA_PADRAO, WebcamCapture } from "../public/capture/webcam-capture";
import type { FonteCaptura } from "../public/capture/webcam-capture";
import { ehCancelamento } from "../src/erros";

function snapshot(frameId = "s-c1-f0"): SnapshotCapturado {
  return Object.freeze({
    frameId,
    imagem: `imagem:${frameId}`,
    capturadoEm: "2026-10-16T10:00:00.000Z",
    capturadoEmMs: 0,
    dimensoes: { largura: 640, altura: 480 },
  });
}

const DETECCAO: ResultadoDeteccaoLocal = {
  deteccoes: [{ nome: "pessoa", rotulo: "person", score: 0.9, caixa: { xmin: 0, ymin: 0, xmax: 1, ymax: 1 } }],
  dimensoes: { largura: 640, altura: 480 },
};

const POSE: ResultadoPose = { pessoas: [{ pontos: [{ x: 0.5, y: 0.5, confianca: 0.9 }] }] };
const MAOS: ResultadoMaos = { maos: [{ lateralidade: "direita", landmarks: [{ x: 0.1, y: 0.1 }] }] };

class DetectorFalso implements DetectorObjetos {
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

class PoseFalso implements EstimadorPose {
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

class MaosFalso implements ReconhecedorGestos {
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

describe("PipelineLocal", () => {
  it("roda deteccao, pose e maos no mesmo frame e associa o resultado ao snapshot", async () => {
    const ordem: string[] = [];
    const pipeline = new PipelineLocal({
      detector: new DetectorFalso(ordem),
      pose: new PoseFalso(ordem),
      maos: new MaosFalso(ordem),
    });

    const resultado = await pipeline.processarFrame(snapshot("s-c1-f2"));

    // Os subsistemas sao disparados na mesma passada (ordem de chamada estavel),
    // mas a conclusao e concorrente — o teste verifica a presenca de todos.
    expect(ordem).toEqual(["deteccao", "pose", "maos"]);
    expect(resultado.deteccoes).toEqual(DETECCAO);
    expect(resultado.pose).toEqual(POSE);
    expect(resultado.maos).toEqual(MAOS);
    expect(resultado.metricas.duracaoDeteccaoMs).toBeTypeOf("number");
    expect(resultado.metricas.duracaoPoseMs).toBeTypeOf("number");
    expect(resultado.metricas.duracaoMaosMs).toBeTypeOf("number");
  });

  it("executa os subsistemas do mesmo frame em paralelo (nao soma as esperas)", async () => {
    let emAndamento = 0;
    let pico = 0;
    const atraso = (ms: number): Promise<void> =>
      new Promise((resolve) => setTimeout(resolve, ms));
    const porta = <T>(resultado: T, ms: number) => async (): Promise<T> => {
      emAndamento += 1;
      pico = Math.max(pico, emAndamento);
      await atraso(ms);
      emAndamento -= 1;
      return resultado;
    };

    const detector: DetectorObjetos = {
      id: "objetos",
      modelo: "obj",
      metricas: {},
      carregar: () => Promise.resolve(),
      detectar: porta(DETECCAO, 20),
      encerrar: () => {},
    };
    const pose: EstimadorPose = {
      id: "pose",
      modelo: "pose",
      metricas: {},
      carregar: () => Promise.resolve(),
      estimar: porta(POSE, 20),
      encerrar: () => {},
    };
    const maos: ReconhecedorGestos = {
      id: "maos",
      modelo: "maos",
      metricas: {},
      carregar: () => Promise.resolve(),
      reconhecer: porta(MAOS, 20),
      encerrar: () => {},
    };

    await new PipelineLocal({ detector, pose, maos }).processarFrame(snapshot());

    // Os tres subsistemas ficam em andamento ao mesmo tempo: o pico concorrente
    // e 3. Se fossem sequenciais, o pico seria 1.
    expect(pico).toBe(3);
  });

  it("isola falha de um subsistema sem apagar o resultado dos demais", async () => {
    const pipeline = new PipelineLocal({
      detector: new DetectorFalso(),
      pose: new PoseFalso([], "lanca"),
      maos: new MaosFalso(),
    });

    const resultado = await pipeline.processarFrame(snapshot());

    // Pose falhou, mas deteccao e maos continuam presentes.
    expect(estaIndisponivel(resultado.pose)).toBe(true);
    expect((resultado.pose as { motivo: string }).motivo).toBe("pose quebrou");
    expect(resultado.deteccoes).toEqual(DETECCAO);
    expect(resultado.maos).toEqual(MAOS);
  });

  it("preserva indisponibilidade devolvida pelo adaptador (nao lanca)", async () => {
    const pipeline = new PipelineLocal({
      detector: new DetectorFalso(),
      pose: new PoseFalso([], "indisponivel"),
      maos: new MaosFalso(),
    });
    const resultado = await pipeline.processarFrame(snapshot());
    expect(estaIndisponivel(resultado.pose)).toBe(true);
    expect(resultado.maos).toEqual(MAOS);
  });

  it("marca subsistemas nao configurados como indisponiveis (desativados)", async () => {
    const pipeline = new PipelineLocal({ detector: new DetectorFalso() });
    const resultado = await pipeline.processarFrame(snapshot());
    expect(resultado.deteccoes).toEqual(DETECCAO);
    expect(resultado.pose).toMatchObject({ indisponivel: true, subsistema: "pose" });
    expect(resultado.maos).toMatchObject({ indisponivel: true, subsistema: "maos" });
  });

  it("le o limiar de deteccao a cada frame", async () => {
    const detectar = vi.fn(
      (_entrada: EntradaAdaptador, _opcoes?: OpcoesDeteccao): Promise<ResultadoDeteccaoLocal> =>
        Promise.resolve(DETECCAO)
    );
    const detector: DetectorObjetos = {
      id: "objetos",
      modelo: "obj",
      metricas: {},
      carregar: () => Promise.resolve(),
      detectar,
      encerrar: () => {},
    };
    const obterThreshold = vi.fn(() => 0.42);
    const pipeline = new PipelineLocal({ detector, obterThreshold });

    await pipeline.processarFrame(snapshot());
    await pipeline.processarFrame(snapshot());

    expect(obterThreshold).toHaveBeenCalledTimes(2);
    expect(detectar.mock.calls[0][1]).toEqual({ threshold: 0.42, percentage: false });
  });

  it("propaga cancelamento em vez de marcar indisponivel", async () => {
    const pipeline = new PipelineLocal({ detector: new DetectorFalso(), pose: new PoseFalso() });
    const controller = new AbortController();
    controller.abort();
    await expect(pipeline.processarFrame(snapshot(), controller.signal)).rejects.toSatisfy(
      ehCancelamento
    );
  });
});

function fonteComImagens(imagens: string[]): FonteCaptura {
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

describe("pipeline local ligado ao ciclo multiframe", () => {
  it("associa cada observacao ao seu frame e isola falha de um modelo", async () => {
    // Pose quebra em todos os frames; deteccao e maos seguem valendo.
    const processarFrame = criarProcessadorFrameLocal({
      detector: new DetectorFalso(),
      pose: new PoseFalso([], "lanca"),
      maos: new MaosFalso(),
    });

    const store = new SnapshotStore({ maxQuadros: 4 });
    const deps: DependenciasCicloMultiframe = {
      captura: new WebcamCapture(fonteComImagens(["A", "B", "C", "D"]), CONFIG_CAPTURA_PADRAO, {
        agora: () => 0,
        esperar: async () => undefined,
        agoraIso: () => "2026-10-16T10:00:00.000Z",
      }),
      store,
      processarFrame,
      interpretador: {
        modelo: null,
        interpretar: async (pacote) => ({
          resumo: `${pacote.observacoes.length} frames`,
          acoes: [],
          evidencias: [],
          incertezas: [],
          contradicoes: [],
          duracaoMs: 1,
        }),
      },
      sessaoId: "sess0001",
      proximoCycleId: () => "sess0001-c1",
      agora: () => 0,
      agoraIso: () => "2026-10-16T10:00:00.000Z",
    };

    const resultado = await executarCicloMultiframe(deps);

    // Uma observacao por frame capturado, com ids e timestamps preservados.
    expect(resultado.pacote.observacoes.map((o) => o.frameId)).toEqual([
      "sess0001-c1-f0",
      "sess0001-c1-f1",
      "sess0001-c1-f2",
      "sess0001-c1-f3",
    ]);
    for (const [i, obs] of resultado.pacote.observacoes.entries()) {
      expect(obs.imagem).toBe(["A", "B", "C", "D"][i]);
      expect(obs.capturadoEm).toBe("2026-10-16T10:00:00.000Z");
      // Falha de pose nao apaga deteccao de objetos nem maos no mesmo frame.
      expect(estaIndisponivel(obs.pose)).toBe(true);
      expect(obs.deteccoes).toEqual(DETECCAO);
      expect(obs.maos).toEqual(MAOS);
    }
    // Falha de subsistema nao derruba o ciclo.
    expect(resultado.cancelado).toBe(false);
  });
});

describe("configurarSubsistemas", () => {
  it("isola falha de carregamento: carregados continuam e falhas sao registradas", async () => {
    const status: string[] = [];
    const detector = new DetectorFalso();
    const pose: PoseFalso = Object.assign(new PoseFalso(), {
      carregar: async () => {
        throw new Error("erro ao carregar pose");
      },
    });
    const maos = new MaosFalso();
    const { configurarSubsistemas } = await import("../public/perception/local-perception-pipeline");
    const resultado = await configurarSubsistemas(
      { detector, pose: pose as unknown as EstimadorPose, maos },
      { objetos: "obj", pose: "pose", maos: "maos" },
      (m) => status.push(m)
    );
    expect(resultado.carregados).toEqual(["deteccao", "maos"]);
    expect(resultado.falhas).toEqual([{ subsistema: "pose", motivo: "erro ao carregar pose" }]);
    expect(status).toEqual(expect.arrayContaining(["pose indisponivel: erro ao carregar pose"]));
  });
});

describe("criarProcessadorInativo (variante B, sem percepcao local)", () => {
  it("devolve os tres subsistemas indisponiveis sem carregar modelo", async () => {
    const processar = criarProcessadorInativo();
    const resultado = await processar(snapshot());

    expect(estaIndisponivel(resultado.deteccoes)).toBe(true);
    expect(estaIndisponivel(resultado.pose)).toBe(true);
    expect(estaIndisponivel(resultado.maos)).toBe(true);
    // Telemetria explicita: cada subsistema desativado aparece como
    // `indisponivel` com motivo, distinguivel de "rodou e nao encontrou nada".
    expect(resultado.metricas.subsistemas).toMatchObject({
      deteccao: { status: "indisponivel" },
      pose: { status: "indisponivel" },
      maos: { status: "indisponivel" },
    });
  });
});
