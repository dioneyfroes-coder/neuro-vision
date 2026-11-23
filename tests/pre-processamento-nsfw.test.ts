import { afterEach, describe, expect, it, vi } from "vitest";
import { CLASSES_NUDENET, formatoSaidaNsfw, interpretarSaidaNudeNetCru } from "../public/nsfw-onnx";
import { LADO_ENTRADA_YOLO, rgbaParaTensorNCHW, rasterizar } from "../public/yolo-onnx";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Canvas minimo so para observar a geometria pedida por `rasterizar`. */
function observableCanvas() {
  const chamadas: Array<[number, number]> = [];
  const contexto = {
    drawImage: (_bitmap: unknown, x: number, y: number, w: number, h: number) => {
      chamadas.push([x, y]);
      expect(w).toBe(h);
    },
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  };
  class CanvasFalso {
    constructor(readonly width: number, readonly height: number) {}
    getContext() {
      return contexto;
    }
  }
  vi.stubGlobal("OffscreenCanvas", CanvasFalso);
  return chamadas;
}

describe("pre-processamento NSFW — o que e verificavel sem os pesos", () => {
  it("faz stretch para o lado de entrada em todos os formatos de frame", () => {
    const formatos: Array<[string, number, number, number]> = [
      ["retrato 9:16", 720, 1280, 320],
      ["paisagem 16:9", 1280, 720, 640],
      ["4:3", 640, 480, 640],
      ["quadrado", 640, 640, 640],
      ["panoramico", 2560, 720, 640],
    ];
    const bitmap = {} as ImageBitmap;
    for (const [, , , lado] of formatos) {
      const chamadas = observableCanvas();
      rasterizar(bitmap, lado);
      // Origem (0,0) e destino quadrado: nao ha padding/letterbox nem offset.
      expect(chamadas).toEqual([[0, 0]]);
    }
  });

  it("monta RGB em NCHW normalizado nos lados 320 e 640", () => {
    for (const lado of [320, 640]) {
      const rgba = new Uint8ClampedArray(lado * lado * 4);
      rgba[0] = 255;
      rgba[1] = 128;
      rgba[2] = 0;
      rgba[4] = 64;
      rgba[(lado * lado - 1) * 4 + 1] = 255;
      const tensor = rgbaParaTensorNCHW(rgba, lado);
      const plano = lado * lado;
      expect(tensor).toHaveLength(3 * plano);
      expect(tensor[0]).toBe(1);
      expect(tensor[plano]).toBeCloseTo(128 / 255, 6);
      expect(tensor[2 * plano]).toBe(0);
      expect(tensor[1]).toBeCloseTo(64 / 255, 6);
      expect(tensor[plano + plano - 1]).toBe(1);
    }
    expect(LADO_ENTRADA_YOLO).toBe(640);
  });

  it("reconhece a dimensao 22 em qualquer ponta da saida crua", () => {
    expect(formatoSaidaNsfw([1, 22, 2100])).toBe("cru");
    expect(formatoSaidaNsfw([1, 2100, 22])).toBe("cru");
    expect(formatoSaidaNsfw([1, 300, 6])).toBe("nms");
    expect(formatoSaidaNsfw([1, 6, 300])).toBe("nms");
    expect(formatoSaidaNsfw([1, 300])).toBe("nms");
  });

  it("decodifica a saida transposta em retrato 9:16, inclusive caixa na borda", () => {
    const lado = 320;
    const largura = 720;
    const altura = 1280;
    const classe = CLASSES_NUDENET.indexOf("MALE_BREAST_EXPOSED");
    expect(classe).toBeGreaterThanOrEqual(0);

    const cru = new Float32Array(22 * 2);
    const preencher = (linha: number, cx: number, cy: number, w: number, h: number) => {
      cru[linha * 22] = cx;
      cru[linha * 22 + 1] = cy;
      cru[linha * 22 + 2] = w;
      cru[linha * 22 + 3] = h;
      cru[linha * 22 + 4 + classe] = 0.9;
    };
    preencher(0, 160, 160, 40, 40);
    preencher(1, 0, 0, 40, 40);

    const deteccoes = interpretarSaidaNudeNetCru(
      cru,
      [1, 2, 22],
      0.5,
      largura,
      altura,
      lado
    ).filter((d) => d.label === "MALE_BREAST_EXPOSED");

    expect(deteccoes).toHaveLength(2);
    const central = deteccoes.find((d) => d.box.xmin > 0);
    expect(central?.box.xmin).toBeCloseTo(315, 5);
    expect(central?.box.ymin).toBeCloseTo(560, 5);
    expect(central?.box.xmax).toBeCloseTo(405, 5);
    expect(central?.box.ymax).toBeCloseTo(720, 5);
    const borda = deteccoes.find((d) => d.box.xmin === 0);
    expect(borda?.box.ymin).toBe(0);
    expect(borda?.box.xmax).toBeCloseTo(45, 5);
    expect(borda?.box.ymax).toBeCloseTo(80, 5);
  });
});
