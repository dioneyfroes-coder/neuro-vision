import { describe, expect, it } from "vitest";
import {
  COCO_INGLES,
  LADO_ENTRADA_YOLO,
  MODELOS_COCO_YOLO,
  DetectorYoloOnnx,
  interpretarSaidaYolo,
  rgbaParaTensorNCHW,
} from "../public/yolo-onnx";

describe("rgbaParaTensorNCHW", () => {
  it("monta RGB em NCHW e normaliza para [0,1]", () => {
    // 2x2: dois pixels brancos e dois pretos
    const lado = 2;
    const rgba = new Uint8ClampedArray([
      255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255,
    ]);
    const tensor = rgbaParaTensorNCHW(rgba, lado);
    expect(tensor.length).toBe(3 * lado * lado);
    // plano R: [1, 0, 1, 0]
    expect(Array.from(tensor.slice(0, 4))).toEqual([1, 0, 1, 0]);
    // plano G e B repetem (imagem em escala de cinza)
    expect(Array.from(tensor.slice(4, 8))).toEqual([1, 0, 1, 0]);
    expect(Array.from(tensor.slice(8, 12))).toEqual([1, 0, 1, 0]);
  });

  it("usa 640x640 por padrao", () => {
    expect(LADO_ENTRADA_YOLO).toBe(640);
    const tensor = rgbaParaTensorNCHW(new Uint8ClampedArray(4 * 640 * 640));
    expect(tensor.length).toBe(3 * 640 * 640);
  });
});

describe("interpretarSaidaYolo", () => {
  // frame original 1280x720, tensor 640x640 -> ex = 2, ey = 1.125
  const dims = [1, 2, 6];

  function saida(): Float32Array {
    // linha 0: pessoa confiavel; linha 1: abaixo do limiar
    return new Float32Array([
      10, 20, 110, 220, 0.91, 0, // person
      0, 0, 50, 50, 0.2, 16, // cat (baixa confianca)
    ]);
  }

  it("converte as caixas do espaco 640 para a resolucao original", () => {
    const [d] = interpretarSaidaYolo(saida(), dims, 0.5, 1280, 720);
    expect(d.label).toBe("person");
    expect(d.score).toBeCloseTo(0.91, 5);
    expect(d.box.xmin).toBeCloseTo(20, 5);
    expect(d.box.ymin).toBeCloseTo(22.5, 5);
    expect(d.box.xmax).toBeCloseTo(220, 5);
    expect(d.box.ymax).toBeCloseTo(247.5, 5);
  });

  it("filtra abaixo do limiar", () => {
    expect(interpretarSaidaYolo(saida(), dims, 0.5, 1280, 720).length).toBe(1);
    expect(interpretarSaidaYolo(saida(), dims, 0.1, 1280, 720).length).toBe(2);
  });

  it("entende a forma transposta [1, 6, 300]", () => {
    const transposta = new Float32Array(12);
    const linhas = 2;
    const bruto = [10, 20, 110, 220, 0.91, 0, 0, 0, 50, 50, 0.2, 16];
    for (let lin = 0; lin < linhas; lin++) {
      for (let col = 0; col < 6; col++) {
        transposta[col * linhas + lin] = bruto[lin * 6 + col];
      }
    }
    const deteccoes = interpretarSaidaYolo(transposta, [1, 6, 2], 0.5, 1280, 720);
    expect(deteccoes.length).toBe(1);
    expect(deteccoes[0].label).toBe("person");
    expect(deteccoes[0].box.xmin).toBeCloseTo(20, 5);
  });

  it("ignora caixas degeneradas", () => {
    const degenerada = new Float32Array([50, 50, 50, 50, 0.99, 0]);
    expect(interpretarSaidaYolo(degenerada, [1, 1, 6], 0.5, 1280, 720).length).toBe(0);
  });

  it("lanca ErroPercepcao para dims invalidos", () => {
    expect(() => interpretarSaidaYolo(new Float32Array(4), [1, 4], 0.5, 10, 10)).toThrow();
  });
});

describe("catalogo YOLO", () => {
  it("expoe nano e small com URLs onnx", () => {
    const chaves = Object.keys(MODELOS_COCO_YOLO);
    expect(chaves).toEqual(["onnx-community/yolov10n", "onnx-community/yolov10s"]);
    for (const { url } of Object.values(MODELOS_COCO_YOLO)) {
      expect(url).toMatch(/^https:\/\/huggingface\.co\/.+\/model\.onnx$/);
    }
  });

  it("resolve chave do catalogo, URL direta e padrao", () => {
    const nano = MODELOS_COCO_YOLO["onnx-community/yolov10n"].url;
    expect(DetectorYoloOnnx.resolverUrl("onnx-community/yolov10n")).toBe(nano);
    expect(DetectorYoloOnnx.resolverUrl("https://exemplo.onnx")).toBe("https://exemplo.onnx");
    expect(DetectorYoloOnnx.resolverUrl("chave-desconhecida")).toBe(
      MODELOS_COCO_YOLO["onnx-community/yolov10n"].url
    );
    expect(DetectorYoloOnnx.resolverUrl(null)).toBe(nano);
  });

  it("tem os 80 rotulos COCO na ordem do modelo", () => {
    expect(COCO_INGLES.length).toBe(80);
    expect(COCO_INGLES[0]).toBe("person");
    expect(COCO_INGLES[16]).toBe("dog");
    expect(COCO_INGLES[79]).toBe("toothbrush");
  });
});
