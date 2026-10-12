import { describe, expect, it, vi } from "vitest";
import { MODOS, obterModo } from "../public/modos";
import { MotorDeteccao, MotorOllama } from "../public/motores";
import type { DetectorObjetos } from "../public/detector";

vi.mock("../public/api", () => ({
  descreverFrame: vi.fn(),
  prepararOllama: vi.fn(),
}));

const detector = {
  modelo: "Xenova/yolos-tiny",
  carregar: vi.fn(),
  executar: vi.fn(),
} as unknown as DetectorObjetos;

const deps = {
  detector,
  modelo: "Xenova/yolos-tiny",
  obterThreshold: () => 0.4,
};

describe("MODOS", () => {
  it("deteccao e eventos usam o motor de deteccao", () => {
    expect(obterModo("deteccao").criarMotor(deps)).toBeInstanceOf(MotorDeteccao);
    expect(obterModo("eventos").criarMotor(deps)).toBeInstanceOf(MotorDeteccao);
  });

  it("ollama e roteiro usam o motor do Ollama com o modo correto", () => {
    const descricao = obterModo("ollama").criarMotor(deps) as MotorOllama;
    const roteiro = obterModo("roteiro").criarMotor(deps) as MotorOllama;
    expect(descricao).toBeInstanceOf(MotorOllama);
    expect(descricao.id).toBe("ollama");
    expect(roteiro.id).toBe("roteiro");
  });

  it("expoe as flags usadas pelo diagnostico e pela interface", () => {
    expect(obterModo("eventos")).toMatchObject({
      usaDeteccao: true,
      usaOllama: true,
      permiteAnaliseManual: true,
    });
    expect(obterModo("deteccao")).toMatchObject({
      usaDeteccao: true,
      usaOllama: false,
      permiteAnaliseManual: false,
    });
    expect(obterModo("ollama")).toMatchObject({
      usaDeteccao: false,
      usaOllama: true,
      permiteAnaliseManual: false,
    });
  });

  it("preserva as mensagens de falha esperadas pelos testes E2E", () => {
    expect(obterModo("deteccao").falhaPrefixo).toBe("Falha ao carregar modelo");
    expect(obterModo("eventos").falhaPrefixo).toBe("Falha ao carregar modelo");
    expect(obterModo("ollama").falhaPrefixo).toBe("Falha ao preparar o Ollama");
    expect(obterModo("roteiro").falhaPrefixo).toBe("Falha ao preparar o Ollama");
  });

  it("modo desconhecido cai no padrao", () => {
    expect(obterModo("inexistente")).toBe(MODOS.deteccao);
  });
});
