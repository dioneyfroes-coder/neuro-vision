import { SnapshotStore } from "../../public/capture/snapshot-store";
import { CONFIG_CAPTURA_PADRAO, WebcamCapture } from "../../public/capture/webcam-capture";
import type { FonteCaptura } from "../../public/capture/webcam-capture";
import type {
  DependenciasCicloMultiframe,
  ProcessamentoFrame,
} from "../../public/cycle/ciclo-multiframe";
import type { InterpretadorMultimodal } from "../../public/interpretation/contracts";
import type { MotorTemporal } from "../../public/temporal/contracts";
import type { PacoteCiclo } from "../../src/domain";
import type { ResultadoInterpretacao } from "../../src/domain";
import type { EventoTemporal, ObservacaoFrame, ResumoTemporal } from "../../src/domain";

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

export function processamento(): ProcessamentoFrame {
  return {
    deteccoes: { deteccoes: [], dimensoes: { largura: 1280, altura: 720 } },
    pose: { pessoas: [] },
    maos: { maos: [] },
    metricas: { duracaoDeteccaoMs: 1, duracaoPoseMs: 2, duracaoMaosMs: 3 },
  };
}

export function interpretadorFalso(vistos: string[][]): InterpretadorMultimodal {
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

export function fonteVazia(): FonteCaptura {
  return {
    ativa: true,
    largura: 1280,
    altura: 720,
    capturarQuadro: () => null,
    assinaturaDeCena: () => null,
  };
}

export function evento(n: number): EventoTemporal {
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

export function motorTemporalFalso(
  vistos: ObservacaoFrame[][],
  produzir: ResumoTemporal | (() => ResumoTemporal) = {
    eventos: [evento(1)],
    tracksAtivos: 1,
    pessoasAtivas: 1,
    maosAtivas: 0,
    objetosAtivos: 0,
  }
): MotorTemporal {
  return {
    processar: (observacoes) => {
      vistos.push([...observacoes]);
      const resumo = typeof produzir === "function" ? produzir() : produzir;
      return { ...resumo, observacoes: [...observacoes] };
    },
    resetar: () => undefined,
  };
}

export function montar(opcoes: {
  imagens?: string[];
  processarFrame?: DependenciasCicloMultiframe["processarFrame"];
  fonte?: FonteCaptura;
  concorrenciaFrames?: number;
  agoraCaptura?: () => number;
  configCaptura?: Partial<typeof CONFIG_CAPTURA_PADRAO>;
  maxQuadros?: number;
} = {}) {
  const imagens = opcoes.imagens ?? ["A", "B", "C", "D"];
  const capturados: string[] = [];
  const interpretados: string[][] = [];
  const configCaptura = { ...CONFIG_CAPTURA_PADRAO, ...opcoes.configCaptura };
  const store = new SnapshotStore({ maxQuadros: opcoes.maxQuadros ?? 4 });
  const captura = new WebcamCapture(
    opcoes.fonte ?? fonteComImagens(imagens),
    configCaptura,
    {
      agora: opcoes.agoraCaptura ?? (() => 0),
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