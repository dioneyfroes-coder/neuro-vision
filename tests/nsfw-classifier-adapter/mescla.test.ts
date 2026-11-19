import { describe, expect, it } from "vitest";
import { LIMITE_IOU_MESCLA_NSFW, mesclarMarcacoesNsfw } from "../../public/perception/adapters/nsfw-classifier.adapter";
import { caixa, marcacao } from "../helpers/nsfw-classifier-adapter";

describe("mesclarMarcacoesNsfw", () => {
  it("deduplica o mesmo rotulo na mesma regiao (IoU alto) e soma os modelos", () => {
    const mescladas = mesclarMarcacoesNsfw([
      marcacao("penis", 0.8, caixa(10, 10, 110, 110), "nudenet_320n"),
      marcacao("penis", 0.6, caixa(12, 12, 108, 108), "penis_yolov8m"),
    ]);
    expect(mescladas).toHaveLength(1);
    expect(mescladas[0].score).toBe(0.8);
    expect(mescladas[0].modelo).toBe("nudenet_320n");
    expect(mescladas[0].modelos).toEqual(["nudenet_320n", "penis_yolov8m"]);
  });

  it("preserva o mesmo rotulo em regioes distintas (IoU baixo)", () => {
    const mescladas = mesclarMarcacoesNsfw([
      marcacao("penis", 0.8, caixa(0, 0, 40, 40), "a"),
      marcacao("penis", 0.7, caixa(200, 200, 260, 260), "b"),
    ]);
    expect(mescladas).toHaveLength(2);
    expect(mescladas.map((m) => m.modelos)).toEqual([["a"], ["b"]]);
  });

  it("nunca suprime rotulos diferentes na mesma regiao (modelos complementares)", () => {
    const mescladas = mesclarMarcacoesNsfw([
      marcacao("penis", 0.9, caixa(0, 0, 100, 100), "a"),
      marcacao("make_love", 0.4, caixa(0, 0, 100, 100), "b"),
    ]);
    expect(mescladas).toHaveLength(2);
    expect(mescladas.map((m) => m.rotulo).sort()).toEqual(["make_love", "penis"]);
  });

  it("usa o limite de IoU exportado como fronteira da mescla", () => {
    expect(LIMITE_IOU_MESCLA_NSFW).toBe(0.6);
    // Duas caixas de mesmo tamanho deslocadas: IoU 0.5 < 0.6 -> ficam separadas.
    const deslocadas = mesclarMarcacoesNsfw([
      marcacao("vagina", 0.8, caixa(0, 0, 100, 100), "a"),
      marcacao("vagina", 0.7, caixa(50, 0, 150, 100), "b"),
    ]);
    expect(deslocadas).toHaveLength(2);
  });

  it("ordena por score decrescente e mantem o maior score no topo", () => {
    const mescladas = mesclarMarcacoesNsfw([
      marcacao("nipple", 0.3, caixa(0, 0, 10, 10), "a"),
      marcacao("penis", 0.9, caixa(50, 50, 60, 60), "b"),
      marcacao("anus", 0.5, caixa(20, 20, 30, 30), "c"),
    ]);
    expect(mescladas.map((m) => m.rotulo)).toEqual(["penis", "anus", "nipple"]);
  });

  it("aceita lista vazia", () => {
    expect(mesclarMarcacoesNsfw([])).toEqual([]);
  });
});
