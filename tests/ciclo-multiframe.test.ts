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
import type { PacoteCiclo } from "../src/domain";
import type { ResultadoInterpretacao } from "../src/domain";
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

function montar(opcoes: {
  imagens?: string[];
  processarFrame?: DependenciasCicloMultiframe["processarFrame"];
} = {}) {
  const imagens = opcoes.imagens ?? ["A", "B", "C", "D"];
  const capturados: string[] = [];
  const interpretados: string[][] = [];
  const store = new SnapshotStore({ maxQuadros: 4 });
  const captura = new WebcamCapture(fonteComImagens(imagens), CONFIG_CAPTURA_PADRAO, {
    agora: () => 0,
    esperar: async () => undefined,
    agoraIso: () => "2026-10-16T10:00:00.000Z",
  });
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

  it("processa os frames em sequencia, depois da captura", async () => {
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
});
