import { describe, expect, it } from "vitest";
import {
  HABILITACAO_PADRAO,
  configurarSubsistemas,
} from "../../public/perception/local-perception-pipeline";
import type { DependenciasPipelineLocal } from "../../public/perception/local-perception-pipeline";
import type { MetricasAdaptador } from "../../public/perception/contracts";

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

  it("registra a carga fria de cada subsistema que tentou carregar (P3.1)", async () => {
    const { deps } = depsFalsas();
    Object.assign(deps.detector!.metricas, {
      status: "ok",
      modelo: "yolov10n",
      dispositivo: "wasm",
      versao: "1.0",
      tempoCargaMs: 1234,
      memoriaBytes: 4096,
    });
    const pose = deps.pose as {
      metricas: MetricasAdaptador;
      carregar: () => Promise<void>;
    };
    pose.metricas = {
      status: "indisponivel",
      motivoFalha: "modelo offline",
      tempoCargaMs: 50,
    };
    pose.carregar = async () => {
      throw new Error("modelo offline");
    };

    const configuracao = await configurarSubsistemas(
      deps,
      { objetos: "yolo", pose: "pose", maos: "maos" },
      undefined,
      { deteccao: true, pose: true, maos: false }
    );

    // Carregado: modelo/dispositivo/versao e custo frio medido.
    expect(configuracao.carregamento?.deteccao).toMatchObject({
      status: "ok",
      modelo: "yolov10n",
      dispositivo: "wasm",
      versao: "1.0",
      tempoCargaMs: 1234,
      memoriaBytes: 4096,
    });
    // Falhou: o custo gasto ate a falha continua sendo carga observada.
    expect(configuracao.carregamento?.pose).toMatchObject({
      status: "indisponivel",
      motivoFalha: "modelo offline",
      tempoCargaMs: 50,
    });
    // Desativado nunca tentou carregar -> sem entrada de telemetria.
    expect(configuracao.carregamento?.maos).toBeUndefined();
  });
});
