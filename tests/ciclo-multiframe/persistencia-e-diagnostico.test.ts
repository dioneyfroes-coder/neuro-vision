import { describe, expect, it } from "vitest";
import { executarCicloMultiframe } from "../../public/cycle/ciclo-multiframe";
import { ehCancelamento } from "../../src/erros";
import { montar } from "../helpers/ciclo-multiframe";

describe("executarCicloMultiframe — persistencia e diagnostico", () => {
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
    deps.obterPolitica = () => ({
      id: "benchmark-500ms",
      finalidade: "benchmark",
      referencia: "500ms",
      intervaloEntreSnapshotsMs: 500,
      quantidadeSnapshots: 4,
      janelaNominalMs: 1500,
      pausaAposCicloMs: 0,
      interpretacao: "a_cada_ciclo",
    });
    deps.obterConfiguracaoCiclo = () => ({
      varianteId: "completa",
      quantidadeSnapshotsConfigurada: 4,
      intervaloEntreSnapshotsMs: 500,
    });
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
      politica: { id: "benchmark-500ms" },
      configuracao: {
        varianteId: "completa",
        quantidadeSnapshotsConfigurada: 4,
        intervaloEntreSnapshotsMs: 500,
      },
    });
  });

});