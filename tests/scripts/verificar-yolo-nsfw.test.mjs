import { describe, expect, it } from "vitest";
import {
  obterMimeEntrada,
  parsearArgumentos,
  validarAmostras,
} from "../../scripts/verificar-yolo-nsfw.mjs";

describe("obterMimeEntrada", () => {
  it("reconhece imagens e videos suportados sem diferenciar maiusculas", () => {
    expect(obterMimeEntrada("foto.PNG")).toBe("image/png");
    expect(obterMimeEntrada("foto.jpeg")).toBe("image/jpeg");
    expect(obterMimeEntrada("clipe.MP4")).toBe("video/mp4");
    expect(obterMimeEntrada("clipe.webm")).toBe("video/webm");
    expect(obterMimeEntrada("arquivo.gif")).toBeUndefined();
  });
});

describe("validarAmostras", () => {
  it("aceita de uma a trinta amostras inteiras", () => {
    expect(validarAmostras("1")).toBe(1);
    expect(validarAmostras("30")).toBe(30);
  });

  it("rejeita valores fora do intervalo ou fracionarios", () => {
    for (const valor of ["0", "31", "1.5", "nao-numero"]) {
      expect(() => validarAmostras(valor)).toThrow(/inteiro entre 1 e 30/);
    }
  });
});

describe("parsearArgumentos", () => {
  it("mantem compatibilidade com o caminho e limiar posicionais", () => {
    expect(parsearArgumentos(["erax_nsfw_yolo11n", "frame.jpg", "0.35"])).toMatchObject({
      modelo: "erax_nsfw_yolo11n",
      entradas: ["frame.jpg"],
      limiar: 0.35,
    });
  });

  it("aceita varias entradas, amostragem de video e auto-descoberta de fixtures", () => {
    expect(
      parsearArgumentos([
        "erax_nsfw_yolo11n",
        "imagem.png",
        "video.mp4",
        "--amostras",
        "7",
        "--fixtures-nsfw",
        "--detalhado",
      ])
    ).toMatchObject({
      entradas: ["imagem.png", "video.mp4"],
      amostras: 7,
      fixturesNsfw: true,
      detalhado: true,
    });
  });

  it("liga o modo detalhado com o atalho -v", () => {
    expect(parsearArgumentos(["modelo", "imagem.png", "-v"])).toMatchObject({
      detalhado: true,
    });
  });

  it("liga o benchmark do conjunto com --conjunto", () => {
    expect(parsearArgumentos(["--conjunto", "clipe.mp4", "--amostras", "3"])).toMatchObject({
      conjunto: true,
      entradas: ["clipe.mp4"],
      amostras: 3,
    });
    // Sem a flag, o comportamento de modelo unico permanece.
    expect(parsearArgumentos(["clipe.mp4"])).toMatchObject({ conjunto: false });
  });

  it("permite desligar COOP/COEP para medir o efeito do isolamento", () => {
    expect(parsearArgumentos(["--conjunto", "clipe.mp4"])).toMatchObject({
      isolamento: true,
    });
    expect(
      parsearArgumentos(["--conjunto", "clipe.mp4", "--sem-isolamento"])
    ).toMatchObject({ isolamento: false });
  });

  it("rejeita limiares invalidos, flags desconhecidas e argumentos incompletos", () => {
    expect(() => parsearArgumentos(["modelo", "2"])).toThrow(/limiar/);
    expect(() => parsearArgumentos(["modelo", "--desconhecida"])).toThrow(/opcao desconhecida/);
    expect(() => parsearArgumentos(["modelo", "--amostras"])).toThrow(/precisa de um valor/);
  });
});
