import { describe, expect, it, vi } from "vitest";
import { iniciarReconhecedorComFallback } from "../../public/gestos";

describe("fallback GPU -> CPU do MediaPipe (item 3, logica testavel)", () => {
  const reconhecedorFalso = { recognize: () => ({ gestures: [], handedness: [], landmarks: [] }) };

  it("usa GPU quando a inicializacao funciona", async () => {
    const criar = vi.fn(async () => reconhecedorFalso);
    const { delegate } = await iniciarReconhecedorComFallback(criar, undefined, 50);
    expect(delegate).toBe("GPU");
    expect(criar).toHaveBeenCalledTimes(1);
  });

  it("cai para CPU quando GPU lanca, avisando pelo status", async () => {
    const mensagens: string[] = [];
    const criar = vi.fn(async (delegate: string) => {
      if (delegate === "GPU") throw new Error("sem WebGL");
      return reconhecedorFalso;
    });
    const { delegate } = await iniciarReconhecedorComFallback(
      criar,
      (m) => mensagens.push(m),
      50
    );
    expect(delegate).toBe("CPU");
    expect(criar).toHaveBeenCalledTimes(2);
    expect(mensagens.join(" ")).toMatch(/GPU indisponivel .*usando CPU/);
  });

  it("cai para CPU quando GPU estoura o timeout", async () => {
    const criar = vi.fn(async (delegate: string) => {
      if (delegate === "GPU") return new Promise(() => {}) as never;
      return reconhecedorFalso;
    });
    const { delegate } = await iniciarReconhecedorComFallback(criar, undefined, 20);
    expect(delegate).toBe("CPU");
  });

  it("propaga erro quando GPU e CPU falham", async () => {
    const criar = async () => {
      throw new Error("ambiente sem suporte");
    };
    await expect(iniciarReconhecedorComFallback(criar, undefined, 50)).rejects.toThrow(
      /GPU e CPU/
    );
  });
});
