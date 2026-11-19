import { describe, expect, it } from "vitest";
import { MODO, montar, primeiro } from "../helpers/ciclo-percepcao-controller";

describe("CicloPercepcaoController — fluxo basico e contexto multimodal", () => {
  it("inicia, roda um ciclo multiframe e persiste diagnostico e entrada", async () => {
    const ctx = montar();
    await ctx.controle.iniciar();

    expect(ctx.cameraEstado.iniciadas).toBe(1);
    expect(ctx.controle.estaRodando).toBe(true);
    expect(primeiro(ctx.eventos, "pronto")).toMatchObject({ definicao: MODO });

    // O diagnostico do ciclo guarda as relacoes sessao/ciclo/frames (2 quadros).
    expect(ctx.ciclos).toHaveLength(1);
    expect(ctx.ciclos[0].observacoes).toBe(2);
    expect(ctx.ciclos[0].frameIds).toHaveLength(2);
    expect(ctx.ciclos[0].configuracao).toMatchObject({
      varianteId: "completa",
      quantidadeSnapshotsConfigurada: 2,
      intervaloEntreSnapshotsMs: 0,
      intervaloAgendamentoMs: 4000,
      modeloMultimodalEfetivo: "modelo-teste",
      interpretador: {
        modeloSolicitado: "modelo-teste",
        incluirDadosLocais: true,
        limites: { maxBytesContexto: 16_000 },
        serializacao: { landmarksCompletos: false },
      },
    });

    // As caixas do ultimo frame foram desenhadas.
    const caixas = primeiro(ctx.eventos, "desenhar_caixas");
    expect(caixas?.objetos).toHaveLength(1);
    expect(caixas?.objetos[0].nome).toBe("pessoa");

    // A interpretacao virou uma entrada do historico.
    const entrada = primeiro(ctx.eventos, "exibir_entrada");
    expect(entrada?.entrada).toMatchObject({
      tipo: "descricao",
      modelo: "modelo-teste",
      resumo: "pessoa gesticulando entre dois frames",
      snapshot: "data:image/jpeg;base64,thumb",
    });
    expect(entrada?.entrada.frameId).toBe(ctx.ciclos[0].frameIds[1]);

    // A entrada foi enfileirada para gravacao (retentativa/ordem).
    expect(ctx.tarefas.map((t) => t.descricao)).toContain("entrada:multiframe");
    await Promise.all(ctx.tarefas.map((t) => t.executar()));
    expect(ctx.entradas).toHaveLength(1);

    ctx.controle.parar();
    expect(primeiro(ctx.eventos, "parado")).toBeTruthy();
    expect(ctx.cameraEstado.encerradas).toBe(1);
  });

  it("registra o truncamento do contexto e mede sua frequencia nos ciclos reais", async () => {
    const ctx = montar({
      contextoMultimodal: {
        bytes: 1400,
        maxBytes: 1000,
        truncado: true,
        excedeuTeto: true,
        gruposRemovidos: [
          { grupo: "keypoints", removidos: 6 },
          { grupo: "movimento", removidos: 2 },
        ],
      },
    });
    await ctx.controle.iniciar();

    expect(ctx.ciclos[0].metricas.contextoMultimodal).toMatchObject({
      truncado: true,
      excedeuTeto: true,
      gruposRemovidos: expect.arrayContaining([
        { grupo: "keypoints", removidos: 6 },
      ]),
    });
    expect(ctx.controle.contagemTruncamentoContexto).toEqual({
      interpretados: 1,
      truncados: 1,
    });
    expect(ctx.controle.taxaTruncamentoContexto).toBe(1);

    await ctx.controle.executarCiclo();
    expect(ctx.controle.contagemTruncamentoContexto).toEqual({
      interpretados: 2,
      truncados: 2,
    });
    expect(ctx.controle.taxaTruncamentoContexto).toBe(1);
    ctx.controle.parar();
  });

});