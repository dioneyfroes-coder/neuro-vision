import { describe, expect, it, vi } from "vitest";
import type { MotorPercepcao } from "../../src/percepcao";
import { montar, statusFinal } from "../helpers/cycle-controller";

describe("CycleController", () => {
  it("falha na inferencia vira status de erro, nao em entradas", async () => {
    const motor: MotorPercepcao = {
      id: "deteccao",
      inicializar: vi.fn(async () => undefined),
      analisar: vi.fn(async () => {
        throw new Error("gpu explodiu");
      }),
      encerrar: vi.fn(),
    };
    const { controlador, eventos, repositorio } = montar({ motor });
    await controlador.iniciar();
    await controlador.executarCiclo();

    expect(eventos.some((e) => e.tipo === "exibir_entrada")).toBe(false);
    expect(statusFinal(eventos)).toContain("gpu explodiu");
    expect(repositorio.gravarOperacional).toHaveBeenCalledWith(
      expect.objectContaining({ nivel: "erro", origem: "detector" })
    );
  });

  it("falha ao carregar o motor libera a camera e sinaliza falha de inicializacao", async () => {
    const motor: MotorPercepcao = {
      id: "deteccao",
      inicializar: vi.fn(async () => {
        throw new Error("sem memoria");
      }),
      analisar: vi.fn(),
      encerrar: vi.fn(),
    };
    const { controlador, eventos, camera } = montar({ motor });
    await controlador.iniciar();

    expect(controlador.estaRodando).toBe(false);
    expect(camera.encerrar).toHaveBeenCalled();
    const falha = eventos.find((e) => e.tipo === "falha_inicializacao");
    expect(falha && falha.tipo === "falha_inicializacao" && falha.mensagem).toContain(
      "Falha ao carregar modelo"
    );
  });
});
