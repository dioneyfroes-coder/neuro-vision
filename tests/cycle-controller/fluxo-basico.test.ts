import { describe, expect, it, vi } from "vitest";
import type { MotorPercepcao, ResultadoPercepcao } from "../../src/percepcao";
import { cameraFalsa, montar, statusFinal } from "../helpers/cycle-controller";

describe("CycleController", () => {
  it("executa o ciclo de frame unico e exibe a entrada capturada", async () => {
    const { controlador, eventos, motor } = montar();
    await controlador.iniciar();
    expect(controlador.estaRodando).toBe(true);
    // `iniciar` dispara o primeiro ciclo pelo agendador; parte do zero daqui.
    eventos.length = 0;
    (motor.analisar as unknown as { mockClear: () => void }).mockClear();

    await controlador.executarCiclo();

    expect(motor.analisar).toHaveBeenCalledTimes(1);
    const exibidas = eventos.filter((e) => e.tipo === "exibir_entrada");
    expect(exibidas).toHaveLength(1);
    expect(statusFinal(eventos)).toContain("Viu:");
    const entrada = exibidas[0];
    expect(entrada.tipo === "exibir_entrada" && entrada.entrada.tipo).toBe("deteccao");
  });

  it("sem frame disponivel o ciclo termina sem erro e sem entradas", async () => {
    const camera = cameraFalsa({ quadro: null });
    camera.capturarFrame = () => null;
    const { controlador, eventos } = montar({ camera });
    await controlador.iniciar();
    await controlador.executarCiclo();
    expect(eventos.some((e) => e.tipo === "exibir_entrada")).toBe(false);
    // Nao e falha: apenas nao ha evidencia neste instante.
    expect(
      eventos.filter((e) => e.tipo === "status" && e.texto.startsWith("Erro"))
    ).toHaveLength(0);
  });

  it("cancelar durante a inferencia nao emite entradas nem derruba o fluxo", async () => {
    let liberar: (v: ResultadoPercepcao) => void = () => {};
    const pendente = new Promise<ResultadoPercepcao>((resolve) => (liberar = resolve));
    const motor: MotorPercepcao = {
      id: "deteccao",
      inicializar: vi.fn(async () => undefined),
      analisar: vi.fn(async (): Promise<ResultadoPercepcao> => ({
        modelo: "falso-modelo",
        duracaoMs: 1,
        objetos: [],
        descricao: "primeiro ciclo",
      })),
      encerrar: vi.fn(),
    };
    const { controlador, eventos, camera } = montar({ motor });
    await controlador.iniciar();
    eventos.length = 0;
    // A proxima inferencia fica pendente ate o cancelamento.
    (motor.analisar as unknown as { mockImplementation: (f: () => Promise<ResultadoPercepcao>) => void }).mockImplementation(
      () => pendente
    );

    const ciclo = controlador.executarCiclo();
    controlador.parar();
    liberar({
      modelo: "falso-modelo",
      duracaoMs: 1,
      objetos: [],
      descricao: "tarde demais",
    });
    await ciclo;

    expect(eventos.some((e) => e.tipo === "exibir_entrada")).toBe(false);
    expect(camera.encerrar).toHaveBeenCalled();
    expect(controlador.estaRodando).toBe(false);
  });

  it("limpar a sessao zera a politica sem depender do interpretador", async () => {
    const { controlador } = montar();
    await controlador.iniciar();
    controlador.reiniciarSessao();
    // Nova sessao pronta para o proximo ciclo; nada aqui invoca visao/Ollama.
    expect(controlador.estaRodando).toBe(true);
    await controlador.executarCiclo();
  });
});
