import { describe, expect, it, vi } from "vitest";
import { AdaptadorPose } from "../public/perception/adapters/pose-estimator.adapter";
import type { MotorPose, SaidaPoseCru } from "../public/perception/adapters/pose-estimator.adapter";
import { AdaptadorMaos } from "../public/perception/adapters/hand-gesture.adapter";
import type { MotorMaos, SaidaMaosCru } from "../public/perception/adapters/hand-gesture.adapter";
import {
  HABILITACAO_PADRAO,
  configurarSubsistemas,
} from "../public/perception/local-perception-pipeline";
import type { DependenciasPipelineLocal } from "../public/perception/local-perception-pipeline";
import type { MetricasAdaptador } from "../public/perception/contracts";
import { normalizarPoses } from "../public/perception/adapters/pose-estimator.adapter";
import { iniciarReconhecedorComFallback } from "../public/gestos";

/**
 * Contratos da percepcao local — Fase 2 da ANALISE_PROFUNDA_NEURO_VISION.
 *
 * Cobre: (1) habilitacao explicita por subsistema; (2) carga idempotente e
 * encerramento real; (5) telemetria (modelo/dispositivo/versao/status) e a
 * validacao deterministica de geometria de keypoints (item 4, parte testavel em
 * CI; o procedimento visual com clipes fica documentado e roda em navegador).
 */

function fakeMotorPose(): MotorPose & { encerrar: ReturnType<typeof vi.fn> } {
  return {
    executar: async (): Promise<SaidaPoseCru> => ({
      pessoas: [{ keypoints: [{ x: 0, y: 0 }], confianca: 0.9 }],
      dimensoes: { largura: 100, altura: 100 },
    }),
    dispositivo: "wasm",
    versao: "teste-1.0",
    encerrar: vi.fn(),
  };
}

function fakeMotorMaos(): MotorMaos & { encerrar: ReturnType<typeof vi.fn> } {
  return {
    executar: async (): Promise<SaidaMaosCru> => ({
      maos: [
        {
          landmarks: [{ x: 0.1, y: 0.2, z: 0 }],
          lateralidade: "Right",
          gestos: [{ nome: "Thumb_Up", confianca: 0.9 }],
        },
      ],
    }),
    dispositivo: "cpu",
    versao: "mediapipe-0.10.21",
    encerrar: vi.fn(),
  };
}

describe("AdaptadorPose — idempotencia e encerramento", () => {
  it("nao recria o motor quando o mesmo modelo e carregado de novo", async () => {
    const motor = fakeMotorPose();
    const criar = vi.fn(async () => motor);
    const adaptador = new AdaptadorPose(criar);

    await adaptador.carregar("modelo-a");
    await adaptador.carregar("modelo-a");
    expect(criar).toHaveBeenCalledTimes(1);
    expect(motor.encerrar).not.toHaveBeenCalled();
  });

  it("troca de modelo encerra o motor anterior antes de criar o novo", async () => {
    const primeiro = fakeMotorPose();
    const segundo = fakeMotorPose();
    const criar = vi
      .fn<[string, ((m: string) => void)?], Promise<MotorPose>>()
      .mockResolvedValueOnce(primeiro)
      .mockResolvedValueOnce(segundo);
    const adaptador = new AdaptadorPose(criar);

    await adaptador.carregar("modelo-a");
    await adaptador.carregar("modelo-b");
    expect(primeiro.encerrar).toHaveBeenCalledTimes(1);
    expect(segundo.encerrar).not.toHaveBeenCalled();
    expect(adaptador.modelo).toBe("modelo-b");
  });

  it("encerrar libera o motor e permite recarregar do zero", async () => {
    const motor = fakeMotorPose();
    const criar = vi.fn(async () => fakeMotorPose());
    criar.mockResolvedValueOnce(motor);
    const adaptador = new AdaptadorPose(criar);

    await adaptador.carregar("modelo-a");
    adaptador.encerrar();
    expect(motor.encerrar).toHaveBeenCalledTimes(1);
    expect(adaptador.metricas.status).toBe("nao_carregado");

    await adaptador.carregar("modelo-a");
    expect(criar).toHaveBeenCalledTimes(2);
  });

  it("estimar sem motor carregado devolve indisponivel (nunca lista vazia)", async () => {
    const adaptador = new AdaptadorPose(async () => fakeMotorPose());
    const resultado = await adaptador.estimar({ imagem: "data:x" });
    expect("indisponivel" in resultado).toBe(true);
  });
});

describe("AdaptadorPose — telemetria por modelo", () => {
  function resultado(parcial: Partial<SaidaPoseCru> = {}): SaidaPoseCru {
    return {
      pessoas: [{ keypoints: [{ x: 50, y: 50, confianca: 0.9 }], confianca: 0.9 }],
      dimensoes: { largura: 100, altura: 100 },
      ...parcial,
    };
  }

  it("registra modelo, dispositivo, versao, status e tempos", async () => {
    const adaptador = new AdaptadorPose(async () => ({
      executar: async () => resultado(),
      dispositivo: "wasm",
      versao: "teste-1.0",
    }));

    await adaptador.carregar("Xenova/yolov8n-pose");
    const metricas = adaptador.metricas as MetricasAdaptador;
    expect(metricas.modelo).toBe("Xenova/yolov8n-pose");
    expect(metricas.dispositivo).toBe("wasm");
    expect(metricas.versao).toBe("teste-1.0");
    expect(metricas.status).toBe("ok");
    expect(metricas.tempoCargaMs).toBeTypeOf("number");

    await adaptador.estimar({ imagem: "data:x" });
    expect(metricas.tempoInferenciaMs).toBeTypeOf("number");
    expect(metricas.status).toBe("ok");
  });

  it("marca 'sem_resultado' quando o modelo roda e nao encontra pessoa", async () => {
    const adaptador = new AdaptadorPose(async () => ({
      executar: async () => resultado({ pessoas: [] }),
    }));
    await adaptador.carregar("modelo");
    await adaptador.estimar({ imagem: "data:x" });
    expect(adaptador.metricas.status).toBe("sem_resultado");
  });

  it("marca 'indisponivel' com motivoFalha quando a inferencia lanca", async () => {
    const adaptador = new AdaptadorPose(async () => ({
      executar: async () => {
        throw new Error("falha simulada");
      },
    }));
    await adaptador.carregar("modelo");
    const saida = await adaptador.estimar({ imagem: "data:x" });
    expect("indisponivel" in saida).toBe(true);
    expect(adaptador.metricas.status).toBe("indisponivel");
    expect(adaptador.metricas.motivoFalha).toBe("falha simulada");
  });
});

describe("AdaptadorMaos — idempotencia, encerramento e telemetria", () => {
  it("nao recria o motor com o mesmo modelo e encerra ao trocar", async () => {
    const primeiro = fakeMotorMaos();
    const segundo = fakeMotorMaos();
    const criar = vi
      .fn<[string, ((m: string) => void)?], Promise<MotorMaos>>()
      .mockResolvedValueOnce(primeiro)
      .mockResolvedValueOnce(segundo);
    const adaptador = new AdaptadorMaos(criar);

    await adaptador.carregar("m");
    await adaptador.carregar("m");
    expect(criar).toHaveBeenCalledTimes(1);

    await adaptador.carregar("n");
    expect(primeiro.encerrar).toHaveBeenCalledTimes(1);
    expect(adaptador.metricas.dispositivo).toBe("cpu");
    expect(adaptador.metricas.versao).toBe("mediapipe-0.10.21");
  });
});

describe("configurarSubsistemas — habilitacao explicita", () => {
  function depsFalsas(): {
    deps: DependenciasPipelineLocal;
    carregados: string[];
    recusados: string[];
  } {
    const carregados: string[] = [];
    const recusados: string[] = [];
    const porta = (nome: string) => ({
      id: nome,
      modelo: null,
      metricas: {} as MetricasAdaptador,
      carregar: async () => {
        carregados.push(nome);
      },
      encerrar: () => {},
    });
    const deps: DependenciasPipelineLocal = {
      detector: { ...porta("deteccao"), detectar: recusados.push.bind(recusados) } as never,
      pose: { ...porta("pose"), estimar: recusados.push.bind(recusados) } as never,
      maos: { ...porta("maos"), reconhecer: recusados.push.bind(recusados) } as never,
      nsfw: { ...porta("nsfw"), avaliar: recusados.push.bind(recusados) } as never,
    };
    return { deps, carregados, recusados };
  }

  it("so carrega subsistemas habilitados com modelo presente", async () => {
    const { deps, carregados } = depsFalsas();
    const configuracao = await configurarSubsistemas(
      deps,
      { objetos: "yolo", pose: "pose", maos: "maos", nsfw: "nsfw" },
      undefined,
      { deteccao: true, pose: false, maos: true, nsfw: false }
    );

    expect(carregados).toEqual(["deteccao", "maos"]);
    expect(configuracao.carregados).toEqual(["deteccao", "maos"]);
    expect(configuracao.desativados).toEqual(["pose", "nsfw"]);
    expect(configuracao.status).toMatchObject({
      deteccao: "carregado",
      pose: "desativado",
      maos: "carregado",
      nsfw: "desativado",
    });
  });

  it("habilidade padrao liga objetos/pose/maos e deixa NSFW desligado", () => {
    expect(HABILITACAO_PADRAO.deteccao).toBe(true);
    expect(HABILITACAO_PADRAO.pose).toBe(true);
    expect(HABILITACAO_PADRAO.maos).toBe(true);
    expect(HABILITACAO_PADRAO.nsfw).toBe(false);
  });

  it("registra falha isolada sem impedir os demais", async () => {
    const { deps } = depsFalsas();
    (deps.pose as { carregar: () => Promise<void> }).carregar = async () => {
      throw new Error("pose quebrou");
    };
    const configuracao = await configurarSubsistemas(
      deps,
      { objetos: "yolo", pose: "pose", maos: "maos" },
      undefined,
      { deteccao: true, pose: true, maos: true }
    );
    expect(configuracao.carregados).toEqual(["deteccao", "maos"]);
    expect(configuracao.falhas).toEqual([{ subsistema: "pose", motivo: "pose quebrou" }]);
    expect(configuracao.status.pose).toBe("falhou");
  });
});

describe("geometria de keypoints (validacao deterministica, item 4)", () => {  const FIXTURES: { nome: string; entrada: SaidaPoseCru; esperado: ReturnType<typeof normalizarPoses> }[] =
    [
      {
        nome: "keypoints nas bordas da imagem permanecem em [0,1]",
        entrada: {
          pessoas: [
            {
              keypoints: [
                { x: 0, y: 0, confianca: 1 },
                { x: 640, y: 480, confianca: 1 },
              ],
            },
          ],
          dimensoes: { largura: 640, altura: 480 },
        },
        esperado: {
          pessoas: [
            {
              pontos: [
                { x: 0, y: 0, confianca: 1 },
                { x: 1, y: 1, confianca: 1 },
              ],
            },
          ],
        },
      },
    ];

  for (const fixture of FIXTURES) {
    it(fixture.nome, () => {
      expect(normalizarPoses(fixture.entrada)).toEqual(fixture.esperado);
    });
  }

  it("prende keypoints fora do frame em [0,1] e nao gera NaN", () => {
    const resultado = normalizarPoses({
      pessoas: [
        {
          keypoints: [
            { x: -50, y: 900, confianca: 0.5 },
            { x: Number.NaN, y: 100, confianca: 0.5 },
          ],
        },
      ],
      dimensoes: { largura: 640, altura: 480 },
    });
    const [a, b] = resultado.pessoas[0].pontos;
    expect(a).toEqual({ x: 0, y: 1, confianca: 0.5 });
    expect(b).toEqual({ x: 0, y: expect.any(Number), confianca: 0.5 });
    expect(Number.isFinite(b.x) && Number.isFinite(b.y)).toBe(true);
  });

  it("dimensoes degeneradas (0) nao geram divisao por zero", () => {
    const resultado = normalizarPoses({
      pessoas: [{ keypoints: [{ x: 10, y: 10, confianca: 0.5 }] }],
      dimensoes: { largura: 0, altura: 0 },
    });
    expect(resultado.pessoas[0].pontos[0].x).toBe(1);
    expect(resultado.pessoas[0].pontos[0].y).toBe(1);
  });
});

describe("fallback GPU -> CPU do MediaPipe (item 3, logica testavel)", () => {
  const reconhecedorFalso = { recognize: () => ({ gestures: [], handedness: [], landmarks: [] }) };

  it("usa GPU quando a inicializacao funciona", async () => {
    const criar = vi.fn(async () => reconhecedorFalso);
    const { delegate } = await iniciarReconhecedorComFallback(criar, undefined, 50);
    expect(delegate).toBe("GPU");
    expect(criar).toHaveBeenCalledTimes(1);
  });

  it("cai para CPU quando GPU lanca, avisando pelo status", async () => {
    const mensagens: string[] = [];
    const criar = vi.fn(async (delegate: string) => {
      if (delegate === "GPU") throw new Error("sem WebGL");
      return reconhecedorFalso;
    });
    const { delegate } = await iniciarReconhecedorComFallback(
      criar,
      (m) => mensagens.push(m),
      50
    );
    expect(delegate).toBe("CPU");
    expect(criar).toHaveBeenCalledTimes(2);
    expect(mensagens.join(" ")).toMatch(/GPU indisponivel .*usando CPU/);
  });

  it("cai para CPU quando GPU estoura o timeout", async () => {
    const criar = vi.fn(async (delegate: string) => {
      if (delegate === "GPU") return new Promise(() => {}) as never;
      return reconhecedorFalso;
    });
    const { delegate } = await iniciarReconhecedorComFallback(criar, undefined, 20);
    expect(delegate).toBe("CPU");
  });

  it("propaga erro quando GPU e CPU falham", async () => {
    const criar = async () => {
      throw new Error("ambiente sem suporte");
    };
    await expect(iniciarReconhecedorComFallback(criar, undefined, 50)).rejects.toThrow(
      /GPU e CPU/
    );
  });
});
