import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DetectorObjetos, descreverDeteccoes, traduzir } from "../public/detector";
import { chamadas, controle } from "./transformers.stub";

beforeEach(() => {
  controle.reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("traduzir", () => {
  it("traduz rotulos COCO conhecidos", () => {
    expect(traduzir("person")).toBe("pessoa");
    expect(traduzir("cell phone")).toBe("celular");
  });

  it("mantem rotulos desconhecidos", () => {
    expect(traduzir("coisa estranha")).toBe("coisa estranha");
  });
});

describe("descreverDeteccoes", () => {
  it("converte deteccoes em objetos e resumo com contagem", () => {
    const { objetos, resumo } = descreverDeteccoes([
      { label: "person", score: 0.9876, box: { xmin: 1, ymin: 2, xmax: 3, ymax: 4 } },
      { label: "person", score: 0.5, box: { xmin: 5, ymin: 6, xmax: 7, ymax: 8 } },
      { label: "dog", score: 0.4, box: { xmin: 9, ymin: 10, xmax: 11, ymax: 12 } },
    ]);

    expect(objetos[0]).toEqual({
      nome: "pessoa",
      rotulo: "person",
      score: 0.988,
      caixa: { xmin: 1, ymin: 2, xmax: 3, ymax: 4 },
    });
    expect(resumo).toBe("2x pessoa, cachorro");
  });

  it("usa 'nada reconhecido' quando nao ha deteccoes", () => {
    expect(descreverDeteccoes([]).resumo).toBe("nada reconhecido");
    expect(descreverDeteccoes([]).objetos).toEqual([]);
  });
});

describe("DetectorObjetos", () => {
  it("carrega, executa e reutiliza o modelo em cache", async () => {
    controle.deteccoes = [
      { label: "car", score: 0.9, box: { xmin: 0, ymin: 0, xmax: 1, ymax: 1 } },
    ];
    const detector = new DetectorObjetos();
    const status: string[] = [];

    await detector.carregar("modelo-a", (m) => status.push(m));
    await detector.carregar("modelo-a", (m) => status.push(m));

    expect(chamadas).toHaveLength(1);
    expect(detector.modelo).toBe("modelo-a");
    expect(status[0]).toBe("Carregando modelo modelo-a...");

    const deteccoes = await detector.executar("data:image/png;base64,AAAA", {
      threshold: 0.5,
      percentage: false,
    });
    expect(deteccoes).toHaveLength(1);
  });

  it("faz fallback para wasm quando a primeira tentativa falha", async () => {
    vi.stubGlobal("navigator", { gpu: {} });
    controle.falharPrimeira = true;
    const detector = new DetectorObjetos();
    const status: string[] = [];

    await detector.carregar("modelo-b", (m) => status.push(m));

    expect(chamadas.map((c) => c.device)).toEqual(["webgpu", "wasm"]);
    expect(status.some((s) => s.startsWith("WebGPU indisponivel"))).toBe(true);
  });

  it("lanca ao executar sem modelo carregado", async () => {
    const detector = new DetectorObjetos();
    await expect(
      detector.executar("x", { threshold: 0.5, percentage: false })
    ).rejects.toThrow("Detector nao carregado");
  });
});
