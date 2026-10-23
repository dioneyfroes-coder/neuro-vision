import { describe, expect, it, vi } from "vitest";
import { SnapshotStore } from "../public/capture/snapshot-store";
import { CONFIG_CAPTURA_PADRAO, WebcamCapture } from "../public/capture/webcam-capture";
import type { FonteCaptura } from "../public/capture/webcam-capture";
import { executarCicloMultiframe } from "../public/cycle/ciclo-multiframe";
import type {
  DependenciasCicloMultiframe,
  ProcessamentoFrame,
} from "../public/cycle/ciclo-multiframe";
import type { InterpretadorMultimodal } from "../public/interpretation/contracts";
import type { MotorTemporal } from "../public/temporal/contracts";
import type { PacoteCiclo } from "../src/domain";
import type { ResultadoInterpretacao } from "../src/domain";
import type { EventoTemporal, ObservacaoFrame, ResumoTemporal } from "../src/domain";
import type { RegistroCiclo } from "../src/domain/cycle";
import { ehCancelamento } from "../src/erros";

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

function processamento(): ProcessamentoFrame {
  return {
    deteccoes: { deteccoes: [], dimensoes: { largura: 1280, altura: 720 } },
    pose: { pessoas: [] },
    maos: { maos: [] },
    metricas: { duracaoDeteccaoMs: 1, duracaoPoseMs: 2, duracaoMaosMs: 3 },
  };
}

function interpretadorFalso(vistos: string[][]): InterpretadorMultimodal {
  return {
    modelo: "modelo-teste",
    interpretar: async (pacote: PacoteCiclo): Promise<ResultadoInterpretacao> => {
      vistos.push(pacote.observacoes.map((o) => o.imagem));
      return {
        resumo: "quatro frames analisados",
        acoes: [],
        evidencias: pacote.observacoes.map((o) => o.frameId),
        incertezas: [],
        contradicoes: [],
        duracaoMs: 42,
      };
    },
  };
}

function fonteVazia(): FonteCaptura {
  return {
    ativa: true,
    largura: 1280,
    altura: 720,
    capturarQuadro: () => null,
    assinaturaDeCena: () => null,
  };
}

function evento(n: number): EventoTemporal {
  return {
    eventoId: `ev${n}`,
    sessionId: "sess0001",
    tipo: "gesto_detectado",
    inicioEm: "2026-10-16T10:00:00.000Z",
    descricao: `evento ${n}`,
    origens: ["maos"],
    frameIds: ["sess0001-c1-f0"],
    estado: "confirmado",
  };
}

function motorTemporalFalso(
  vistos: ObservacaoFrame[][],
  produzir: ResumoTemporal | (() => ResumoTemporal) = { eventos: [evento(1)], entidadesAtivas: 1 }
): MotorTemporal {
  return {
    processar: (observacoes) => {
      vistos.push([...observacoes]);
      return typeof produzir === "function" ? produzir() : produzir;
    },
    resetar: () => undefined,
  };
}

function montar(opcoes: {
  imagens?: string[];
  processarFrame?: DependenciasCicloMultiframe["processarFrame"];
  fonte?: FonteCaptura;
  concorrenciaFrames?: number;
} = {}) {
  const imagens = opcoes.imagens ?? ["A", "B", "C", "D"];
  const capturados: string[] = [];
  const interpretados: string[][] = [];
  const store = new SnapshotStore({ maxQuadros: 4 });
  const captura = new WebcamCapture(
    opcoes.fonte ?? fonteComImagens(imagens),
    CONFIG_CAPTURA_PADRAO,
    {
      agora: () => 0,
      esperar: async () => undefined,
      agoraIso: () => "2026-10-16T10:00:00.000Z",
    }
  );
  const processarFrame =
    opcoes.processarFrame ??
    (async (snapshot) => {
      capturados.push(snapshot.imagem);
      return processamento();
    });

  const deps: DependenciasCicloMultiframe = {
    captura,
    store,
    processarFrame,
    ...(opcoes.concorrenciaFrames !== undefined
      ? { concorrenciaFrames: opcoes.concorrenciaFrames }
      : {}),
    interpretador: interpretadorFalso(interpretados),
    sessaoId: "sess0001",
    proximoCycleId: () => "sess0001-c1",
    agora: () => 0,
    agoraIso: () => "2026-10-16T10:00:00.000Z",
  };
  return { deps, capturados, interpretados, store };
}

describe("executarCicloMultiframe", () => {
  it("usa as mesmas imagens, ids e timestamps na deteccao e na interpretacao", async () => {
    const { deps, capturados, interpretados } = montar();
    const resultado = await executarCicloMultiframe(deps);

    // A captura identificou quatro frames.
    const imagensCapturadas = deps.store.quadros.map((s) => s.imagem);
    expect(imagensCapturadas).toEqual(["A", "B", "C", "D"]);

    // As imagens enviadas a deteccao sao exatamente as capturadas...
    expect(capturados).toEqual(imagensCapturadas);
    // ...e as enviadas a interpretacao tambem.
    expect(interpretados).toEqual([imagensCapturadas]);

    // Pacote: ids e timestamps preservados por observacao.
    expect(resultado.pacote.observacoes.map((o) => o.frameId)).toEqual([
      "sess0001-c1-f0",
      "sess0001-c1-f1",
      "sess0001-c1-f2",
      "sess0001-c1-f3",
    ]);
    for (const obs of resultado.pacote.observacoes) {
      expect(obs.capturadoEm).toBe("2026-10-16T10:00:00.000Z");
      expect(obs.imagem).toBe(imagensCapturadas[Number(obs.frameId.slice(-1))]);
    }
    expect(resultado.interpretacao).toBe("quatro frames analisados");
    expect(resultado.cancelado).toBe(false);
  });

  it("preserva a ordem dos frames ao processar depois da captura", async () => {
    const ordem: string[] = [];
    const { deps } = montar({
      processarFrame: async (snapshot) => {
        ordem.push(`proc:${snapshot.frameId}`);
        return processamento();
      },
    });
    await executarCicloMultiframe(deps);
    expect(ordem).toEqual([
      "proc:sess0001-c1-f0",
      "proc:sess0001-c1-f1",
      "proc:sess0001-c1-f2",
      "proc:sess0001-c1-f3",
    ]);
  });

  it("processa frames em paralelo com concorrencia limitada (ordem preservada)", async () => {
    let emAndamento = 0;
    let pico = 0;
    const { deps, interpretados } = montar({
      concorrenciaFrames: 2,
      processarFrame: async () => {
        emAndamento += 1;
        pico = Math.max(pico, emAndamento);
        await new Promise((resolve) => setTimeout(resolve, 5));
        emAndamento -= 1;
        return processamento();
      },
    });

    const resultado = await executarCicloMultiframe(deps);

    // No maximo 2 frames avancam juntos (limite pedido) e pelo menos 2 de fato
    // coincidem — prova que nao rodou estritamente em serie.
    expect(pico).toBe(2);
    // A ordem das observacoes segue a ordem de captura, nao a de conclusao.
    expect(resultado.pacote.observacoes.map((o) => o.imagem)).toEqual(["A", "B", "C", "D"]);
    expect(interpretados).toEqual([["A", "B", "C", "D"]]);
  });

  it("registra falha de processamento como indisponivel sem apagar a evidencia", async () => {
    const { deps, interpretados } = montar({
      processarFrame: async () => {
        throw new Error("modelo quebrou");
      },
    });
    const resultado = await executarCicloMultiframe(deps);

    expect(resultado.erros).toHaveLength(4);
    expect(resultado.erros[0].etapa).toBe("deteccao");
    for (const obs of resultado.pacote.observacoes) {
      expect(obs.deteccoes).toMatchObject({ indisponivel: true, subsistema: "deteccao" });
      expect(obs.pose).toMatchObject({ indisponivel: true });
      expect(obs.maos).toMatchObject({ indisponivel: true });
    }
    // Mesmo com falha local, as imagens capturadas ainda vao a interpretacao.
    expect(interpretados).toEqual([["A", "B", "C", "D"]]);
  });

  it("limpa o buffer e propaga o cancelamento", async () => {
    const { deps, store } = montar();
    const controller = new AbortController();
    controller.abort();
    await expect(executarCicloMultiframe(deps, controller.signal)).rejects.toSatisfy(
      ehCancelamento
    );
    expect(store.tamanho).toBe(0);
  });

  it("nao captura a webcam dentro do interpretador (recebe so o pacote)", async () => {
    const interpretar = vi.fn(interpretadorFalso([]).interpretar);
    const { deps } = montar();
    deps.interpretador = { modelo: null, interpretar };
    await executarCicloMultiframe(deps);
    expect(interpretar).toHaveBeenCalledTimes(1);
    const pacote = interpretar.mock.calls[0][0] as PacoteCiclo;
    expect(pacote.observacoes).toHaveLength(4);
    // O interpretador nao tem acesso a uma fonte de captura: so o pacote.
    expect(Object.keys(pacote)).not.toContain("camera");
  });

  it("persiste o diagnostico do ciclo com as relacoes sessao/ciclo/frames", async () => {
    const { deps } = montar();
    const registros: RegistroCiclo[] = [];
    deps.persistirCiclo = (registro) => {
      registros.push(registro);
    };
    const resultado = await executarCicloMultiframe(deps);

    expect(registros).toHaveLength(1);
    expect(registros[0]).toMatchObject({
      sessionId: "sess0001",
      cycleId: "sess0001-c1",
      frameIds: ["sess0001-c1-f0", "sess0001-c1-f1", "sess0001-c1-f2", "sess0001-c1-f3"],
      observacoes: 4,
      cancelado: false,
      interpretacao: "quatro frames analisados",
    });
    // A gravacao entra nas metricas do ciclo.
    expect(typeof resultado.pacote.metricas.persistenciaMs).toBe("number");
  });

  it("falha de gravacao nao derruba o ciclo nem a interpretacao", async () => {
    const { deps } = montar();
    deps.persistirCiclo = () => {
      throw new Error("disco cheio");
    };
    const resultado = await executarCicloMultiframe(deps);
    expect(resultado.interpretacao).toBe("quatro frames analisados");
    expect(resultado.erros).toContainEqual({
      etapa: "persistencia",
      mensagem: "disco cheio",
    });
  });

  it("persiste o diagnostico de um ciclo cancelado antes de propagar", async () => {
    const { deps, store } = montar();
    const registros: RegistroCiclo[] = [];
    deps.persistirCiclo = (registro) => {
      registros.push(registro);
    };
    const controller = new AbortController();
    controller.abort();
    await expect(executarCicloMultiframe(deps, controller.signal)).rejects.toSatisfy(
      ehCancelamento
    );
    expect(store.tamanho).toBe(0);
    expect(registros).toHaveLength(1);
    expect(registros[0]).toMatchObject({
      sessionId: "sess0001",
      cycleId: "sess0001-c1",
      cancelado: true,
    });
  });

  it("liga o motor temporal: consome as observacoes e alimenta o pacote", async () => {
    const { deps } = montar();
    const vistos: ObservacaoFrame[][] = [];
    deps.motorTemporal = motorTemporalFalso(vistos);

    const resultado = await executarCicloMultiframe(deps);

    // O motor recebeu exatamente as observacoes do ciclo, na ordem.
    expect(vistos).toHaveLength(1);
    expect(vistos[0].map((o) => o.frameId)).toEqual([
      "sess0001-c1-f0",
      "sess0001-c1-f1",
      "sess0001-c1-f2",
      "sess0001-c1-f3",
    ]);
    // O resumo temporal entra no pacote (eventos + leitura consolidada).
    expect(resultado.pacote.eventosTemporais).toEqual([evento(1)]);
    expect(resultado.pacote.resumoTemporal).toEqual({
      eventos: [evento(1)],
      entidadesAtivas: 1,
    });
    expect(typeof resultado.pacote.metricas.temporalMs).toBe("number");
    expect(resultado.erros).toHaveLength(0);
  });

  it("falha do motor temporal vira erro de etapa sem derrubar a interpretacao", async () => {
    const { deps } = montar();
    deps.motorTemporal = motorTemporalFalso([], () => {
      throw new Error("motor temporal quebrou");
    });

    const resultado = await executarCicloMultiframe(deps);

    expect(resultado.erros).toContainEqual({
      etapa: "temporal",
      mensagem: "motor temporal quebrou",
    });
    expect(resultado.pacote.eventosTemporais).toEqual([]);
    expect(resultado.pacote.resumoTemporal).toEqual({ eventos: [], entidadesAtivas: 0 });
    // O ciclo segue: a interpretacao multimodal ainda acontece.
    expect(resultado.interpretacao).toBe("quatro frames analisados");
  });

  it("sem frame disponivel nao interpreta nem persiste (nao e falha)", async () => {
    const { deps, interpretados } = montar({ fonte: fonteVazia() });
    const registros: RegistroCiclo[] = [];
    deps.persistirCiclo = (registro) => {
      registros.push(registro);
    };

    const resultado = await executarCicloMultiframe(deps);

    expect(resultado.pacote.observacoes).toHaveLength(0);
    expect(resultado.interpretacao).toBeUndefined();
    expect(resultado.cancelado).toBe(false);
    expect(interpretados).toHaveLength(0);
    expect(registros).toHaveLength(0);
  });

  it("registra concluidoEm no fim, depois da interpretacao e da persistencia", async () => {
    const ordem: string[] = [];
    const { deps } = montar({
      processarFrame: async () => {
        ordem.push("percepcao");
        return processamento();
      },
    });
    deps.agoraIso = () => "2026-10-16T10:00:00.000Z";
    deps.interpretador = {
      modelo: "m",
      interpretar: async (): Promise<ResultadoInterpretacao> => {
        ordem.push("interpretacao");
        return {
          resumo: "x",
          acoes: [],
          evidencias: [],
          incertezas: [],
          contradicoes: [],
          duracaoMs: 5,
        };
      },
    };
    deps.persistirCiclo = () => {
      ordem.push("persistencia");
    };

    const resultado = await executarCicloMultiframe(deps);
    ordem.push("retorno");

    // A ordem do ciclo e captura -> percepcao -> interpretacao -> persistencia.
    expect(ordem.indexOf("interpretacao")).toBeLessThan(ordem.indexOf("persistencia"));
    expect(ordem.indexOf("persistencia")).toBeLessThan(ordem.indexOf("retorno"));
    // concluidoEm so existe depois de tudo: o pacote terminou.
    expect(resultado.pacote.concluidoEm).toBe("2026-10-16T10:00:00.000Z");
    expect(resultado.pacote.metricas.concluidoEm).toBe("2026-10-16T10:00:00.000Z");
  });

  it("registra timestamps por etapa (item 4)", async () => {
    const { deps } = montar();
    deps.motorTemporal = motorTemporalFalso([]);
    const resultado = await executarCicloMultiframe(deps);
    const m = resultado.pacote.metricas;

    expect(m.capturaConcluidaEm).toBe("2026-10-16T10:00:00.000Z");
    expect(m.percepcaoConcluidaEm).toBe("2026-10-16T10:00:00.000Z");
    expect(m.temporalConcluidoEm).toBe("2026-10-16T10:00:00.000Z");
    expect(m.interpretacaoConcluidaEm).toBe("2026-10-16T10:00:00.000Z");
    expect(m.persistenciaConcluidaEm).toBe("2026-10-16T10:00:00.000Z");
    expect(m.concluidoEm).toBe("2026-10-16T10:00:00.000Z");
  });

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
});
