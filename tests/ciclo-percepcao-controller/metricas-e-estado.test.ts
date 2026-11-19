import { describe, expect, it } from "vitest";
import { MODO_B, MODO_C, montar, primeiro } from "../helpers/ciclo-percepcao-controller";

describe("CicloPercepcaoController — metricas, variantes e estado da sessao", () => {
  it("falha ao acessar a camera impede a sessao sem rodar ciclos", async () => {
    const ctx = montar({ falhaAoIniciar: new Error("permissao negada") });
    await ctx.controle.iniciar();

    expect(ctx.controle.estaRodando).toBe(false);
    expect(primeiro(ctx.eventos, "falha_inicializacao")?.mensagem).toContain("permissao negada");
    expect(ctx.ciclos).toHaveLength(0);
    expect(ctx.cameraEstado.encerradas).toBe(1);
  });

  it("propaga a carga fria por modelo para as metricas do ciclo (P3.1)", async () => {
    const ctx = montar({
      configuracao: {
        carregados: ["deteccao", "pose", "maos"],
        falhas: [],
        desativados: [],
        status: {
          deteccao: "carregado",
          pose: "carregado",
          maos: "carregado",
          nsfw: "desativado",
        },
        carregamento: {
          deteccao: {
            status: "ok",
            modelo: "yolov10n",
            dispositivo: "wasm",
            tempoCargaMs: 1200,
            memoriaBytes: 2048,
          },
          pose: { status: "ok", modelo: "yolov8n-pose", tempoCargaMs: 300 },
        },
      },
    });
    await ctx.controle.iniciar();

    expect(ctx.ciclos).toHaveLength(1);
    const carga = ctx.ciclos[0].metricas.cargaModelos;
    expect(carga?.subsistemas.deteccao).toMatchObject({
      modelo: "yolov10n",
      dispositivo: "wasm",
      tempoCargaMs: 1200,
      memoriaBytes: 2048,
    });
    expect(carga?.subsistemas.pose?.tempoCargaMs).toBe(300);
    expect(carga?.totalMs).toBeGreaterThanOrEqual(0);
    ctx.controle.parar();
  });

  it("mede a latencia entre ciclos a partir do fim do anterior", async () => {
    const ctx = montar();
    await ctx.controle.iniciar();

    // O primeiro ciclo da sessao nao tem referencia anterior.
    expect(ctx.ciclos[0].metricas.latenciaEntreCiclosMs).toBeUndefined();

    await ctx.controle.executarCiclo();
    expect(ctx.ciclos).toHaveLength(2);
    expect(typeof ctx.ciclos[1].metricas.latenciaEntreCiclosMs).toBe("number");
    expect(ctx.ciclos[1].metricas.latenciaEntreCiclosMs).toBeGreaterThanOrEqual(0);
    ctx.controle.parar();
  });

  it("sem nenhum subsistema carregado, falha antes de rodar", async () => {
    const ctx = montar({
      configuracao: { carregados: [], falhas: [{ subsistema: "pose", motivo: "modelo offline" }] },
    });
    await ctx.controle.iniciar();

    expect(ctx.controle.estaRodando).toBe(false);
    const falha = primeiro(ctx.eventos, "falha_inicializacao");
    expect(falha?.mensagem).toContain("Falha ao carregar o pipeline de percepcao");
    expect(falha?.mensagem).toContain("pose: modelo offline");
    expect(ctx.ciclos).toHaveLength(0);
  });

  it("um subsistema carregado ja permite rodar (falha parcial nao bloqueia)", async () => {
    const ctx = montar({
      configuracao: { carregados: ["deteccao"], falhas: [{ subsistema: "pose", motivo: "sem modelo" }] },
    });
    await ctx.controle.iniciar();

    expect(ctx.controle.estaRodando).toBe(true);
    expect(ctx.ciclos).toHaveLength(1);
    ctx.controle.parar();
  });

  it("reiniciar a sessao zera o estado temporal e libera o buffer", () => {
    const ctx = montar();
    ctx.controle.reiniciarSessao();
    expect(ctx.resetes).toHaveBeenCalledTimes(1);
    expect(ctx.controle.estaRodando).toBe(false);
  });

  it("variante B (sequencia) nao carrega modelos, nao pede temporal e roda sem caixas", async () => {
    const ctx = montar({ modo: MODO_B });
    await ctx.controle.iniciar();

    expect(ctx.controle.estaRodando).toBe(true);
    // Sem percepcao local: nada de modelos e a fabrica de temporal nunca e usada.
    expect(ctx.modelosVistos).toHaveLength(0);
    expect(ctx.modosTemporais).toHaveLength(0);
    // O ciclo roda normalmente e o processador inativo nao desenha caixas.
    expect(ctx.ciclos).toHaveLength(1);
    expect(ctx.ciclos[0].observacoes).toBe(2);
    expect(ctx.ciclos[0].eventosTemporais).toBe(0);
    expect(ctx.ciclos[0].subsistemasIndisponiveis).toEqual(
      expect.arrayContaining(["deteccao", "pose", "maos"])
    );
    expect(primeiro(ctx.eventos, "desenhar_caixas")?.objetos).toHaveLength(0);
    // A interpretacao (multimodal) continua acontecendo com as imagens.
    expect(primeiro(ctx.eventos, "exibir_entrada")).toBeTruthy();

    ctx.controle.parar();
  });

  it("variante C (fundida) carrega modelos e pede motor temporal basico", async () => {
    const ctx = montar({ modo: MODO_C });
    await ctx.controle.iniciar();

    expect(ctx.controle.estaRodando).toBe(true);
    expect(ctx.modelosVistos).toHaveLength(1);
    expect(ctx.modosTemporais).toContain("basico");
    expect(ctx.modosTemporais).not.toContain("ampliado");
    // Percepcao local ativa: as caixas voltam a ser desenhadas.
    expect(primeiro(ctx.eventos, "desenhar_caixas")?.objetos).toHaveLength(1);
    ctx.controle.parar();
  });

  it("variante padrao (D) pede motor temporal ampliado", async () => {
    const ctx = montar();
    await ctx.controle.iniciar();
    expect(ctx.modosTemporais).toContain("ampliado");
    ctx.controle.parar();
  });

  it("carrega os modelos escolhidos na interface ao iniciar a sessao", async () => {
    const ctx = montar({ modelos: { objetos: "onnx-community/yolov10s" } });
    await ctx.controle.iniciar();

    expect(ctx.modelosVistos).toEqual([{ objetos: "onnx-community/yolov10s" }]);
    ctx.controle.parar();
  });

  it("trocar de modo reinicia a sessao (novo contexto temporal)", () => {
    const ctx = montar();
    ctx.controle.aoTrocarModo();
    expect(ctx.resetes).toHaveBeenCalledTimes(1);
  });

});