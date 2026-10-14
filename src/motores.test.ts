import { describe, expect, it, vi } from "vitest";
import { MotorDeteccao, MotorOllama } from "../public/motores";
import * as api from "../public/api";
import type { DetectorObjetos } from "../public/detector";

vi.mock("../public/api", () => ({
  descreverFrame: vi.fn(),
  prepararOllama: vi.fn(),
}));

describe("MotorDeteccao", () => {
  it("carrega o modelo e devolve um ResultadoPercepcao padronizado", async () => {
    const detector = {
      modelo: "Xenova/yolos-tiny",
      carregar: vi.fn(async () => undefined),
      executar: vi.fn(async () => [
        {
          label: "person",
          score: 0.92,
          box: { xmin: 0, ymin: 2, xmax: 3, ymax: 4 },
        },
      ]),
    } as unknown as DetectorObjetos;
    const motor = new MotorDeteccao({
      detector,
      modelo: "Xenova/yolos-tiny",
      obterThreshold: () => 0.4,
    });

    const status: string[] = [];
    await motor.inicializar((m) => status.push(m));
    expect(detector.carregar).toHaveBeenCalledWith("Xenova/yolos-tiny", expect.any(Function));

    const resultado = await motor.analisar(
      { imagem: "data:image/png;base64,AAAA" },
      new AbortController().signal
    );
    expect(detector.executar).toHaveBeenCalledWith("data:image/png;base64,AAAA", {
      threshold: 0.4,
      percentage: false,
    });
    expect(resultado?.modelo).toBe("Xenova/yolos-tiny");
    expect(resultado?.descricao).toBe("pessoa");
    expect(resultado?.objetos[0]).toEqual({
      nome: "pessoa",
      rotulo: "person",
      score: 0.92,
      caixa: { xmin: 0, ymin: 2, xmax: 3, ymax: 4 },
    });
    expect(typeof resultado?.duracaoMs).toBe("number");
  });

  it("usa o limiar lido a cada analise", async () => {
    const detector = {
      modelo: "x",
      carregar: vi.fn(async () => undefined),
      executar: vi.fn(async () => []),
    } as unknown as DetectorObjetos;
    let threshold = 0.3;
    const motor = new MotorDeteccao({
      detector,
      modelo: "x",
      obterThreshold: () => threshold,
    });
    await motor.analisar({ imagem: "a" }, new AbortController().signal);
    threshold = 0.7;
    await motor.analisar({ imagem: "b" }, new AbortController().signal);
    expect(detector.executar).toHaveBeenNthCalledWith(1, "a", {
      threshold: 0.3,
      percentage: false,
    });
    expect(detector.executar).toHaveBeenNthCalledWith(2, "b", {
      threshold: 0.7,
      percentage: false,
    });
  });
});

describe("MotorOllama", () => {
  it("monta o payload de roteiro e devolve descricao padronizada", async () => {
    vi.mocked(api.descreverFrame).mockResolvedValue({
      evento: {
        type: "done",
        descricao: "Um gato no sofa.",
        modelo: "qwen3-vl:4b",
        tokens: 42,
        papel: "delta",
      },
      parcial: "",
    });
    const motor = new MotorOllama({ modo: "roteiro", roteiro: "beat", base: false });
    const sinal = new AbortController().signal;
    const progressos: string[] = [];

    const resultado = await motor.analisar(
      { imagem: "b64", snapshot: "data:image/jpeg;base64,BBBB" },
      sinal,
      (p) => progressos.push(p)
    );

    expect(api.descreverFrame).toHaveBeenCalledWith(
      {
        imagem: "b64",
        snapshot: "data:image/jpeg;base64,BBBB",
        modo: "roteiro",
        roteiro: "beat",
        base: false,
      },
      sinal,
      expect.any(Function)
    );
    expect(resultado?.descricao).toBe("Um gato no sofa.");
    expect(resultado?.modelo).toBe("qwen3-vl:4b");
    expect(resultado?.confianca).toMatchObject({ tokens: 42, papel: "delta", semMudanca: undefined });
  });

  it("monta o payload de descricao com a observacao anterior", async () => {
    vi.mocked(api.descreverFrame).mockResolvedValue({ evento: null, parcial: "parcial" });
    const motor = new MotorOllama({ modo: "descricao", anterior: "before" });

    const resultado = await motor.analisar(
      { imagem: "b64" },
      new AbortController().signal
    );

    expect(api.descreverFrame).toHaveBeenCalledWith(
      { imagem: "b64", anterior: "before" },
      expect.any(AbortSignal),
      undefined
    );
    expect(resultado?.descricao).toBe("parcial");
  });

  it("repassa semMudanca para o roteiro", async () => {
    vi.mocked(api.descreverFrame).mockResolvedValue({
      evento: { semMudanca: true, descricao: "sem mudanca" },
      parcial: "",
    });
    const motor = new MotorOllama({ modo: "roteiro" });
    const resultado = await motor.analisar({ imagem: "b64" }, new AbortController().signal);
    expect(resultado?.confianca?.semMudanca).toBe(true);
  });

  it("inicializar notifica status com o tempo de carregamento", async () => {
    vi.mocked(api.prepararOllama).mockResolvedValue({
      modelo: "qwen2.5vl:3b",
      carregado: true,
      carregandoMs: 3000,
    });
    const motor = new MotorOllama({ modo: "descricao" });
    const status: string[] = [];
    await motor.inicializar((m) => status.push(m));
    expect(status[0]).toContain("Carregando modelo");
    expect(status[1]).toContain("3s");
    expect(status[1]).toContain("qwen2.5vl:3b");
  });

  it("falha quando o modelo nao e confirmado em memoria", async () => {
    vi.mocked(api.prepararOllama).mockResolvedValue({ carregado: false });
    const motor = new MotorOllama({ modo: "descricao" });
    await expect(motor.inicializar()).rejects.toThrow("modelo nao confirmado em memoria");
  });
});