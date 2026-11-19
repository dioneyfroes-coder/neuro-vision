import { describe, expect, it, vi } from "vitest";
import type { FonteCaptura } from "../../public/capture/webcam-capture";
import { executarCicloMultiframe } from "../../public/cycle/ciclo-multiframe";
import type { ProcessamentoFrame } from "../../public/cycle/ciclo-multiframe";
import { naoAmostrado } from "../../src/domain";
import { ehCancelamento } from "../../src/erros";
import { fonteVazia, motorTemporalFalso, montar, processamento } from "../helpers/ciclo-multiframe";

describe("executarCicloMultiframe — politica, janela de captura e metricas", () => {
  it("suprime a interpretacao pela politica e registra o motivo", async () => {
    const { deps, interpretados } = montar();
    deps.decidirInterpretacao = () => ({ interpretar: false, motivo: "sem_evento_relevante" });

    const resultado = await executarCicloMultiframe(deps);

    expect(interpretados).toHaveLength(0);
    expect(resultado.interpretacao).toBeUndefined();
    expect(resultado.pacote.metricas.interpretacaoSuprimida).toBe("sem_evento_relevante");
    // O ciclo continua valido: interpretacao suprimida nao e falha.
    expect(resultado.erros).toHaveLength(0);
    expect(resultado.cancelado).toBe(false);
    // E conclui normalmente (concluidoEm registrado).
    expect(resultado.pacote.concluidoEm).toBe("2026-10-16T10:00:00.000Z");
  });

  it("interpreta quando a politica decide pelo evento relevante", async () => {
    const { deps, interpretados } = montar();
    deps.motorTemporal = motorTemporalFalso([]);
    deps.decidirInterpretacao = () => ({ interpretar: true });

    const resultado = await executarCicloMultiframe(deps);

    expect(interpretados).toHaveLength(1);
    expect(resultado.interpretacao).toBe("quatro frames analisados");
    expect(resultado.pacote.metricas.interpretacaoSuprimida).toBeUndefined();
  });

  it("registra a politica aplicada no pacote e no registro persistido", async () => {
    const { deps } = montar();
    const politica = {
      id: "benchmark-1s",
      finalidade: "benchmark" as const,
      referencia: "1s",
      intervaloEntreSnapshotsMs: 1000,
      quantidadeSnapshots: 4,
      janelaNominalMs: 3000,
      pausaAposCicloMs: 6000,
      interpretacao: "a_cada_ciclo" as const,
    };
    deps.obterPolitica = () => politica;
    let persistido: RegistroCiclo | undefined;
    deps.persistirCiclo = (registro) => {
      persistido = registro;
    };

    const resultado = await executarCicloMultiframe(deps);

    expect(resultado.pacote.politica).toEqual(politica);
    expect(persistido?.politica).toEqual(politica);
  });

  it("calcula janelaCapturaMs a partir dos timestamps reais dos snapshots", async () => {
    let relogio = 0;
    const { deps } = montar({
      agoraCaptura: () => {
        const valor = relogio;
        relogio += 500;
        return valor;
      },
    });

    const resultado = await executarCicloMultiframe(deps);

    // 4 snapshots capturados em 0, 1000, 2000 e 3000 ms.
    expect(resultado.pacote.metricas.janelaCapturaMs).toBe(3000);
  });

  it("janelaCapturaMs e 0 quando o ciclo tem um unico snapshot", async () => {
    let chamadas = 0;
    const fonte: FonteCaptura = {
      ativa: true,
      largura: 1280,
      altura: 720,
      capturarQuadro: () => {
        chamadas += 1;
        return chamadas === 1 ? { imagem: "A", thumb: "thumb:A" } : null;
      },
      assinaturaDeCena: () => null,
    };
    const { deps } = montar({ fonte });

    const resultado = await executarCicloMultiframe(deps);

    expect(resultado.pacote.observacoes).toHaveLength(1);
    expect(resultado.pacote.metricas.janelaCapturaMs).toBe(0);
  });

  it("separa inferencia aquecida por snapshot do custo do conjunto (P3.1)", async () => {
    const metricasPorFrame: Array<ProcessamentoFrame["metricas"]> = [
      {
        duracaoDeteccaoMs: 1,
        duracaoPoseMs: 2,
        duracaoMaosMs: 3,
        subsistemas: {
          deteccao: { status: "ok", tempoInferenciaMs: 10, memoriaBytes: 100 },
          pose: { status: "ok", tempoInferenciaMs: 20 },
          maos: { status: "indisponivel", motivoFalha: "mao nao detectada" },
        },
      },
      {
        duracaoDeteccaoMs: 1,
        duracaoPoseMs: 2,
        duracaoMaosMs: 3,
        subsistemas: {
          deteccao: { status: "ok", tempoInferenciaMs: 30, memoriaBytes: 300 },
          pose: { status: "ok", tempoInferenciaMs: 40 },
          maos: { status: "indisponivel", motivoFalha: "mao nao detectada" },
        },
      },
      {
        duracaoDeteccaoMs: 1,
        duracaoPoseMs: 2,
        duracaoMaosMs: 3,
        subsistemas: {
          deteccao: { status: "ok", tempoInferenciaMs: 50, memoriaBytes: 200 },
          pose: { status: "ok", tempoInferenciaMs: 60 },
          maos: { status: "indisponivel", motivoFalha: "mao nao detectada" },
        },
      },
      {
        duracaoDeteccaoMs: 1,
        duracaoPoseMs: 2,
        duracaoMaosMs: 3,
        subsistemas: {
          deteccao: { status: "ok", tempoInferenciaMs: 70, memoriaBytes: 250 },
          pose: { status: "ok", tempoInferenciaMs: 80 },
          maos: { status: "indisponivel", motivoFalha: "mao nao detectada" },
        },
      },
    ];
    let indice = 0;
    const { deps } = montar({
      processarFrame: async () => ({
        ...processamento(),
        metricas: metricasPorFrame[indice++],
      }),
    });
    let relogio = 0;
    deps.agora = () => (relogio += 5);
    const registrarFim = vi.fn();
    deps.registrarFimCiclo = registrarFim;

    const resultado = await executarCicloMultiframe(deps);
    const m = resultado.pacote.metricas;

    // Media do custo aquecido por snapshot, por subsistema (10,30,50,70 -> 40;
    // 20,40,60,80 -> 50). Maos nunca teve inferencia valida -> ausente, nao 0.
    expect(m.inferenciaPorSnapshotMs).toEqual({ deteccao: 40, pose: 50 });
    expect(m.percepcaoTotalMs).toBeGreaterThan(0);
    expect(m.latenciaAteRespostaMultimodalMs).toBeGreaterThan(0);
    expect(m.memoriaMaximaBytes).toBeGreaterThanOrEqual(300);
    // O fim do ciclo e registrado uma vez para alimentar a proxima latencia.
    expect(registrarFim).toHaveBeenCalledTimes(1);
  });

  it("propaga carga fria e latencia entre ciclos, mas nao inventa resposta suprimida", async () => {
    const carga = {
      totalMs: 1500,
      subsistemas: {
        deteccao: { status: "ok" as const, modelo: "yolo", tempoCargaMs: 1200 },
      },
    };
    const { deps } = montar();
    deps.obterCargaModelos = () => carga;
    deps.obterLatenciaEntreCiclosMs = () => 700;

    const resultado = await executarCicloMultiframe(deps);

    expect(resultado.pacote.metricas.cargaModelos).toEqual(carga);
    expect(resultado.pacote.metricas.latenciaEntreCiclosMs).toBe(700);
    expect(resultado.pacote.metricas.percepcaoTotalMs).toBeTypeOf("number");

    const suprimido = montar();
    suprimido.deps.decidirInterpretacao = () => ({
      interpretar: false,
      motivo: "sem_evento_relevante",
    });
    const semResposta = await executarCicloMultiframe(suprimido.deps);
    expect(semResposta.pacote.metricas.latenciaAteRespostaMultimodalMs).toBeUndefined();
  });

  it("registra o fim do ciclo tambem quando nao ha frame ou quando cancela", async () => {
    const semFrame = montar({ fonte: fonteVazia() });
    const registrarSemFrame = vi.fn();
    semFrame.deps.registrarFimCiclo = registrarSemFrame;
    await executarCicloMultiframe(semFrame.deps);
    expect(registrarSemFrame).toHaveBeenCalledTimes(1);

    const cancelado = montar();
    const registrarCancelado = vi.fn();
    cancelado.deps.registrarFimCiclo = registrarCancelado;
    const controller = new AbortController();
    controller.abort();
    await expect(
      executarCicloMultiframe(cancelado.deps, controller.signal)
    ).rejects.toSatisfy(ehCancelamento);
    expect(registrarCancelado).toHaveBeenCalledTimes(1);
  });

  it("aplica a cadencia independente e registra a amostragem efetiva (Fase 1.3)", async () => {
    type Amostrados = { deteccao: boolean; pose: boolean; maos: boolean };
    const pedidos: Amostrados[] = [];
    let relogio = 0;
    const { deps } = montar({
      configCaptura: { quadros: 4, intervaloMs: 300 },
      // Duas leituras por frame (captura + espera) -> timestamps 0, 600, 1200, 1800.
      agoraCaptura: () => {
        const valor = relogio;
        relogio += 300;
        return valor;
      },
      processarFrame: async (_snapshot, _sinal, amostragem) => {
        const amostrar = (subsistema: "deteccao" | "pose" | "maos"): boolean =>
          amostragem === undefined || amostragem.has(subsistema);
        const pedido: Amostrados = {
          deteccao: amostrar("deteccao"),
          pose: amostrar("pose"),
          maos: amostrar("maos"),
        };
        pedidos.push(pedido);
        return {
          deteccoes: pedido.deteccao ? processamento().deteccoes : naoAmostrado("deteccao"),
          pose: pedido.pose ? processamento().pose : naoAmostrado("pose"),
          maos: pedido.maos ? processamento().maos : naoAmostrado("maos"),
          metricas: {},
        };
      },
    });
    deps.obterPolitica = () => ({
      id: "benchmark-5fps",
      finalidade: "benchmark",
      referencia: "5fps",
      intervaloEntreSnapshotsMs: 300,
      quantidadeSnapshots: 4,
      janelaNominalMs: 900,
      pausaAposCicloMs: 0,
      interpretacao: "a_cada_ciclo",
      cadencia: { maosMs: 300, poseMs: 1200, deteccaoMs: 1200 },
    });
    const registros: RegistroCiclo[] = [];
    deps.persistirCiclo = (registro) => {
      registros.push(registro);
    };

    const resultado = await executarCicloMultiframe(deps);

    // O plano usa os timestamps reais da captura, nao a ordem de conclusao.
    expect(resultado.pacote.metricas.janelaCapturaMs).toBe(1800);
    expect(pedidos.map((pedido) => pedido.maos)).toEqual([true, true, true, true]);
    expect(pedidos.map((pedido) => pedido.pose)).toEqual([true, false, true, false]);
    expect(pedidos.map((pedido) => pedido.deteccao)).toEqual([true, false, true, false]);

    const amostragem = resultado.pacote.metricas.amostragem;
    expect(amostragem?.janelaMs).toBe(1800);
    expect(amostragem?.porSubsistema.maos).toMatchObject({
      amostrados: 4,
      intervaloAlvoMs: 300,
    });
    expect(amostragem?.porSubsistema.pose).toMatchObject({
      amostrados: 2,
      intervaloAlvoMs: 1200,
    });

    // Frame pulado pela cadencia nao e indisponibilidade no registro.
    expect(registros[0]?.subsistemasIndisponiveis).toEqual([]);
  });
});