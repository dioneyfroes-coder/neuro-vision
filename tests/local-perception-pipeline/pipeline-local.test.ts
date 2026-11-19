import { describe, expect, it, vi } from "vitest";
import { PipelineLocal } from "../../public/perception/local-perception-pipeline";
import type {
  DetectorObjetos,
  EntradaAdaptador,
  EstimadorPose,
  OpcoesDeteccao,
  ReconhecedorGestos,
} from "../../public/perception/contracts";
import { estaIndisponivel } from "../../src/domain";
import type { ResultadoDeteccaoLocal } from "../../src/domain";
import { ehCancelamento } from "../../src/erros";
import {
  DETECCAO,
  DetectorFalso,
  MAOS,
  MaosFalso,
  POSE,
  PoseFalso,
  snapshot,
} from "../helpers/local-perception-pipeline";

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

  it("propaga carga, inferência e memória sem herdar inferência inválida (P3.1)", async () => {
    const detector = new DetectorFalso();
    const pose = new PoseFalso([], "indisponivel");
    const maos = new MaosFalso();
    detector.metricas.status = "ok";
    detector.metricas.modelo = "obj-teste";
    detector.metricas.tempoCargaMs = 100;
    detector.metricas.tempoInferenciaMs = 12;
    detector.metricas.memoriaBytes = 2048;
    // Pose devolveu `indisponivel`: o tempo da ultima inferencia valida do
    // adaptador nao pode ser herdado por este frame.
    pose.metricas.tempoCargaMs = 30;
    pose.metricas.tempoInferenciaMs = 99;
    maos.metricas.status = "ok";
    maos.metricas.tempoInferenciaMs = 7;

    const pipeline = new PipelineLocal({ detector, pose, maos });
    const resultado = await pipeline.processarFrame(snapshot());

    expect(resultado.metricas.subsistemas?.deteccao).toMatchObject({
      status: "ok",
      modelo: "obj-teste",
      tempoCargaMs: 100,
      memoriaBytes: 2048,
    });
    expect(resultado.metricas.subsistemas?.deteccao?.tempoInferenciaMs).toBe(
      resultado.metricas.duracaoDeteccaoMs
    );
    expect(resultado.metricas.subsistemas?.pose).toMatchObject({ status: "indisponivel" });
    expect(resultado.metricas.subsistemas?.pose?.tempoInferenciaMs).toBeUndefined();
    expect(resultado.metricas.subsistemas?.maos?.tempoInferenciaMs).toBe(
      resultado.metricas.duracaoMaosMs
    );
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
