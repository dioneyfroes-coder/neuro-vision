import { describe, expect, it, vi } from "vitest";
import { MotorDeteccao, MotorVisao } from "../public/motores";
import * as api from "../public/api";
import type { DetectorObjetos } from "../public/perception/contracts";

vi.mock("../public/api", () => ({
  descreverFrame: vi.fn(),
  prepararVisao: vi.fn(),
}));

describe("MotorDeteccao", () => {
  it("carrega o modelo e devolve um ResultadoPercepcao padronizado", async () => {
    const detector = {
      modelo: "onnx-community/yolov10n",
      carregar: vi.fn(async () => undefined),
      detectar: vi.fn(async () => ({
        deteccoes: [
          {
            nome: "pessoa",
            rotulo: "person",
            score: 0.92,
            caixa: { xmin: 0, ymin: 2, xmax: 3, ymax: 4 },
          },
        ],
        dimensoes: { largura: 640, altura: 480 },
        modelo: "onnx-community/yolov10n",
        resumo: "pessoa",
      })),
    } as unknown as DetectorObjetos;
    const motor = new MotorDeteccao({
      detector,
      modelo: "onnx-community/yolov10n",
      obterThreshold: () => 0.4,
    });

    const status: string[] = [];
    await motor.inicializar((m) => status.push(m));
    expect(detector.carregar).toHaveBeenCalledWith("onnx-community/yolov10n", expect.any(Function));

    const resultado = await motor.analisar(
      { imagem: "data:image/png;base64,AAAA" },
      new AbortController().signal
    );
    expect(detector.detectar).toHaveBeenCalledWith(
      { imagem: "data:image/png;base64,AAAA", dimensoes: undefined },
      { threshold: 0.4, percentage: false }
    );
    expect(resultado?.modelo).toBe("onnx-community/yolov10n");
    expect(resultado?.descricao).toBe("pessoa");
    expect(resultado?.objetos[0]).toEqual({
      nome: "pessoa",
      rotulo: "person",
      score: 0.92,
      caixa: { xmin: 0, ymin: 2, xmax: 3, ymax: 4 },
    });
    expect(typeof resultado?.duracaoMs).toBe("number");
  });

  it("repassa as dimensoes do frame ao adaptador", async () => {
    const detector = {
      modelo: "x",
      carregar: vi.fn(async () => undefined),
      detectar: vi.fn(async () => ({ deteccoes: [], resumo: "nada reconhecido" })),
    } as unknown as DetectorObjetos;
    const motor = new MotorDeteccao({ detector, modelo: "x", obterThreshold: () => 0.5 });
    await motor.analisar(
      { imagem: "a", dimensoes: { largura: 1280, altura: 720 } },
      new AbortController().signal
    );
    expect(detector.detectar).toHaveBeenCalledWith(
      { imagem: "a", dimensoes: { largura: 1280, altura: 720 } },
      { threshold: 0.5, percentage: false }
    );
  });

  it("usa o limiar lido a cada analise", async () => {
    const detector = {
      modelo: "x",
      carregar: vi.fn(async () => undefined),
      detectar: vi.fn(async () => ({ deteccoes: [], resumo: "nada reconhecido" })),
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
    expect(detector.detectar).toHaveBeenNthCalledWith(
      1,
      { imagem: "a", dimensoes: undefined },
      { threshold: 0.3, percentage: false }
    );
    expect(detector.detectar).toHaveBeenNthCalledWith(
      2,
      { imagem: "b", dimensoes: undefined },
      { threshold: 0.7, percentage: false }
    );
  });
});

describe("MotorVisao", () => {
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
    const motor = new MotorVisao({ modo: "roteiro", roteiro: "beat", base: false });
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
    const motor = new MotorVisao({ modo: "descricao", anterior: "before" });

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
    const motor = new MotorVisao({ modo: "roteiro" });
    const resultado = await motor.analisar({ imagem: "b64" }, new AbortController().signal);
    expect(resultado?.confianca?.semMudanca).toBe(true);
  });

  it("envia o modelo escolhido no preparo e no payload", async () => {
    vi.mocked(api.descreverFrame).mockResolvedValue({ evento: null, parcial: "" });
    vi.mocked(api.prepararVisao).mockResolvedValue({ modelo: "gemma-4-e2b", carregado: true });
    const motor = new MotorVisao({ modo: "descricao", modelo: "gemma-4-e2b" });

    await motor.inicializar();
    expect(api.prepararVisao).toHaveBeenCalledWith("gemma-4-e2b");

    await motor.analisar({ imagem: "b64" }, new AbortController().signal);
    expect(api.descreverFrame).toHaveBeenCalledWith(
      { imagem: "b64", modelo: "gemma-4-e2b" },
      expect.any(AbortSignal),
      undefined
    );
  });

  it("omite o modelo do payload quando nao ha escolha na interface", async () => {
    vi.mocked(api.descreverFrame).mockResolvedValue({ evento: null, parcial: "" });
    const motor = new MotorVisao({ modo: "descricao" });

    await motor.analisar({ imagem: "b64" }, new AbortController().signal);

    expect(api.descreverFrame).toHaveBeenCalledWith(
      { imagem: "b64" },
      expect.any(AbortSignal),
      undefined
    );
  });

  it("inicializar notifica status com o tempo de carregamento", async () => {
    vi.mocked(api.prepararVisao).mockResolvedValue({
      modelo: "qwen2.5vl:3b",
      carregado: true,
      carregandoMs: 3000,
    });
    const motor = new MotorVisao({ modo: "descricao" });
    const status: string[] = [];
    await motor.inicializar((m) => status.push(m));
    expect(status[0]).toContain("Carregando modelo");
    expect(status[1]).toContain("3s");
    expect(status[1]).toContain("qwen2.5vl:3b");
  });

  it("falha quando o modelo nao e confirmado em memoria", async () => {
    vi.mocked(api.prepararVisao).mockResolvedValue({ carregado: false });
    const motor = new MotorVisao({ modo: "descricao" });
    await expect(motor.inicializar()).rejects.toThrow("modelo nao confirmado em memoria");
  });
});