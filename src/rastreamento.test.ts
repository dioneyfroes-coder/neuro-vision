import { describe, expect, it } from "vitest";
import {
  CONFIG_RASTREAMENTO_PADRAO,
  RastreadorObjetos,
  area,
  distanciaCentros,
  interseccaoSobreUniao,
} from "./rastreamento";
import type { Caixa, ObjetoVisto } from "./types";

function det(rotulo: string, caixa: Caixa, score = 0.9, nome = rotulo): ObjetoVisto {
  return { rotulo, nome, score, caixa };
}

const pessoa = (x = 0, y = 0): ObjetoVisto =>
  det("person", { xmin: x, ymin: y, xmax: x + 100, ymax: y + 100 }, 0.9, "pessoa");

describe("geometria", () => {
  it("calcula area, IoU e distancia entre centros", () => {
    const a = { xmin: 0, ymin: 0, xmax: 100, ymax: 100 };
    expect(area(a)).toBe(10000);
    expect(interseccaoSobreUniao(a, a)).toBeCloseTo(1);
    expect(interseccaoSobreUniao(a, { xmin: 200, ymin: 200, xmax: 300, ymax: 300 })).toBe(0);
    expect(distanciaCentros(a, { xmin: 20, ymin: 0, xmax: 120, ymax: 100 })).toBeCloseTo(20);
  });
});

describe("RastreadorObjetos", () => {
  it("detectar a mesma pessoa em dois frames gera uma unica aparicao", () => {
    const r = new RastreadorObjetos();
    const f1 = r.processar([pessoa()], 1000);
    expect(f1.eventos.map((e) => e.tipo)).toEqual(["aparicao"]);
    expect(f1.objetos).toHaveLength(1);
    expect(f1.objetos[0].id).toBe("obj-1");

    const f2 = r.processar([pessoa()], 2000);
    expect(f2.eventos).toEqual([]);
    expect(f2.objetos[0].id).toBe("obj-1");
    expect(f2.objetos[0].framesVisto).toBe(2);
  });

  it("objetos da mesma classe em regioes diferentes recebem IDs distintos", () => {
    const r = new RastreadorObjetos();
    const f = r.processar([pessoa(0, 0), pessoa(300, 300)], 1000);
    expect(f.objetos.map((o) => o.id)).toEqual(["obj-1", "obj-2"]);
    expect(f.eventos.map((e) => e.tipo)).toEqual(["aparicao", "aparicao"]);
  });

  it("caixa deslocada mas sobreposta mantem o mesmo ID", () => {
    const r = new RastreadorObjetos();
    r.processar([pessoa(0, 0)], 1000);
    const f2 = r.processar([pessoa(5, 5)], 1050);
    expect(f2.eventos).toEqual([]);
    expect(f2.objetos[0].id).toBe("obj-1");
  });

  it("deslocamento relevante gera evento de movimento", () => {
    const r = new RastreadorObjetos();
    r.processar([pessoa(0, 0)], 1000);
    const f2 = r.processar([pessoa(20, 0)], 1100);
    expect(f2.eventos.map((e) => e.tipo)).toEqual(["movimento"]);
    expect(f2.eventos[0].objetoId).toBe("obj-1");
    expect(f2.eventos[0].origem).toBe("rastreador");
  });

  it("deteccao ausente por um frame nao gera desaparecimento nem nova aparicao", () => {
    const r = new RastreadorObjetos();
    r.processar([pessoa()], 1000);
    const vazio = r.processar([], 1200);
    expect(vazio.eventos).toEqual([]);
    expect(vazio.objetos).toHaveLength(1);
    expect(vazio.objetos[0].framesAusente).toBe(1);

    const volta = r.processar([pessoa()], 1400);
    expect(volta.eventos).toEqual([]);
    expect(volta.objetos[0].id).toBe("obj-1");
    expect(volta.objetos[0].framesVisto).toBe(2);
  });

  it("dois frames ausentes geram desaparecimento", () => {
    const r = new RastreadorObjetos();
    r.processar([pessoa()], 1000);
    r.processar([], 1100);
    const f3 = r.processar([], 1200);
    expect(f3.eventos.map((e) => e.tipo)).toEqual(["desaparecimento"]);
    expect(f3.objetos).toHaveLength(0);
  });

  it("objeto que reaparece apos desaparecer ganha novo ID", () => {
    const r = new RastreadorObjetos();
    r.processar([pessoa()], 1000);
    r.processar([], 1100);
    r.processar([], 1200);
    const volta = r.processar([pessoa()], 1300);
    expect(volta.eventos.map((e) => e.tipo)).toEqual(["aparicao"]);
    expect(volta.objetos[0].id).not.toBe("obj-1");
  });

  it("classes diferentes na mesma caixa nao se associam", () => {
    const r = new RastreadorObjetos();
    r.processar([pessoa()], 1000);
    const f2 = r.processar([det("dog", { xmin: 0, ymin: 0, xmax: 100, ymax: 100 }, 0.9, "cachorro")], 1100);
    expect(f2.eventos.map((e) => e.tipo)).toEqual(["aparicao"]);
    expect(f2.objetos.map((o) => o.rotulo).sort()).toEqual(["dog", "person"]);
  });

  it("descarta deteccoes com confianca abaixo do minimo", () => {
    const r = new RastreadorObjetos();
    const f = r.processar([det("person", { xmin: 0, ymin: 0, xmax: 10, ymax: 10 }, 0.1, "pessoa")], 1000);
    expect(f.objetos).toHaveLength(0);
    expect(f.eventos).toEqual([]);
  });

  it("remove objetos expirados mesmo sem frames ausentes suficientes", () => {
    const r = new RastreadorObjetos();
    r.processar([pessoa()], 1000);
    const f2 = r.processar([], 1000 + CONFIG_RASTREAMENTO_PADRAO.expiracaoMs + 1);
    expect(f2.eventos.map((e) => e.tipo)).toEqual(["desaparecimento"]);
    expect(f2.objetos).toHaveLength(0);
  });

  it("reiniciar limpa o estado e os IDs", () => {
    const r = new RastreadorObjetos();
    r.processar([pessoa()], 1000);
    r.reiniciar();
    const f = r.processar([pessoa()], 2000);
    expect(f.objetos[0].id).toBe("obj-1");
    expect(f.objetos[0].framesVisto).toBe(1);
  });

  it("persistencia de aparicao filtra deteccoes isoladas", () => {
    const r = new RastreadorObjetos({ framesParaConfirmarAparicao: 2 });
    const f1 = r.processar([pessoa()], 1000);
    expect(f1.eventos).toEqual([]);
    const f2 = r.processar([pessoa()], 1100);
    expect(f2.eventos.map((e) => e.tipo)).toEqual(["aparicao"]);

    const r2 = new RastreadorObjetos({ framesParaConfirmarAparicao: 2 });
    r2.processar([pessoa()], 1000);
    const some = r2.processar([], 1100);
    expect(some.eventos).toEqual([]);
    expect(some.objetos).toHaveLength(1);
    const confirmaSumico = r2.processar([], 1200);
    expect(confirmaSumico.eventos).toEqual([]);
    expect(confirmaSumico.objetos).toHaveLength(0);
  });

  it("camera parada mantem um unico objeto sem eventos apos a aparicao", () => {
    const r = new RastreadorObjetos();
    expect(r.processar([pessoa()], 1000).eventos.map((e) => e.tipo)).toEqual(["aparicao"]);
    const f2 = r.processar([pessoa()], 1100);
    const f3 = r.processar([pessoa()], 1200);
    expect(f2.eventos).toEqual([]);
    expect(f3.eventos).toEqual([]);
    expect(f3.objetos).toHaveLength(1);
    expect(f3.objetos[0].framesVisto).toBe(3);
  });

  it("oclusao parcial mantem a identidade do objeto", () => {
    const r = new RastreadorObjetos({ movimentoMinimoRelativo: 0.5 });
    r.processar([pessoa(0, 0)], 1000);
    // Metade inferior ocluida: caixa menor, ainda sobreposta.
    const ocluido = det("person", { xmin: 0, ymin: 0, xmax: 100, ymax: 60 }, 0.9, "pessoa");
    const f2 = r.processar([ocluido], 1100);
    expect(f2.objetos).toHaveLength(1);
    expect(f2.objetos[0].id).toBe("obj-1");
    expect(f2.objetos[0].caixa.ymax).toBe(60);
    expect(f2.eventos.some((e) => e.tipo === "aparicao")).toBe(false);
  });
});