import { describe, expect, it } from "vitest";
import {
  CONFIG_RASTREAMENTO_PADRAO,
  RastreadorObjetos,
  area,
  distanciaCentros,
  interseccaoSobreUniao,
} from "../src/rastreamento";
import type { Caixa, ObjetoVisto } from "../src/types";

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
    r.processar([pessoa()], 1000);
    const f1 = r.processar([pessoa()], 2000);
    expect(f1.eventos.map((e) => e.tipo)).toEqual(["aparicao"]);
    expect(f1.objetos).toHaveLength(1);
    const objId1 = f1.objetos[0].id;
    expect(objId1).toMatch(/^obj-/);

    const f2 = r.processar([pessoa()], 3000);
    expect(f2.eventos).toEqual([]);
    expect(f2.objetos[0].id).toBe(objId1);
    expect(f2.objetos[0].framesVisto).toBe(3); // com 3 frames processados total considerando confirmacao? 
    // frame1 (1000) + frame2 (2000) confirma aparicao; frame3 (3000) soma +1
    expect(f2.objetos[0].framesVisto).toBe(3);
  });

  it("objetos da mesma classe em regioes diferentes recebem IDs distintos", () => {
    const r = new RastreadorObjetos();
    const f = r.processar([pessoa(0, 0), pessoa(300, 300)], 1000);
    expect(f.objetos.map((o) => o.id)).toHaveLength(2);
    expect(f.objetos[0].id).toMatch(/^obj-/);
    expect(f.objetos[1].id).toMatch(/^obj-/);
    expect(f.objetos[1].id).not.toBe(f.objetos[0].id);
    // com framesParaConfirmarAparicao=2, ainda nao emite aparicao no primeiro frame
    expect(f.eventos).toEqual([]);
  });

  it("caixa deslocada mas sobreposta mantem o mesmo ID", () => {
    const r = new RastreadorObjetos();
    r.processar([pessoa(0, 0)], 1000);
    const f1a = r.processar([pessoa(0, 0)], 1000);
    const objId1 = f1a.objetos[0].id;
    const f2 = r.processar([pessoa(5, 5)], 1050);
    expect(f2.eventos).toEqual([]);
    expect(f2.objetos[0].id).toBe(objId1);
  });

  it("deslocamento relevante gera evento de movimento", () => {
    const r = new RastreadorObjetos();
    r.processar([pessoa(0, 0)], 1000);
    r.processar([pessoa(0, 0)], 1000);
    const f2 = r.processar([pessoa(20, 0)], 1100);
    expect(f2.eventos.map((e) => e.tipo)).toEqual(["movimento"]);
    expect(f2.eventos[0].objetoId).toMatch(/^obj-/);
    expect(f2.eventos[0].origem).toBe("rastreador");
  });

  it("deteccao ausente por um frame nao gera desaparecimento nem nova aparicao", () => {
    const r = new RastreadorObjetos();
    // confirmar aparicao precisa de 2 frames
    r.processar([pessoa()], 1000);
    r.processar([pessoa()], 1200);
    expect(r.processar([], 1400).eventos).toEqual([]);
    const vazio = r.processar([], 1500);
    expect(vazio.eventos).toEqual([]);
    expect(vazio.objetos).toHaveLength(1);
    expect(vazio.objetos[0].framesAusente).toBe(2); // ausente no frame 1400 e 1500

    const volta = r.processar([pessoa()], 1600);
    expect(volta.eventos).toEqual([]);
    expect(volta.objetos[0].id).toMatch(/^obj-/);
    expect(volta.objetos[0].framesVisto).toBe(3);
  });

  it("ausencia prolongada gera desaparecimento", () => {
    const r = new RastreadorObjetos();
    r.processar([pessoa()], 1000);
    r.processar([pessoa()], 1100);
    r.processar([], 1200);
    r.processar([], 1300);
    const f4 = r.processar([], 1400);
    expect(f4.eventos.map((e) => e.tipo)).toEqual(["desaparecimento"]);
    expect(f4.objetos).toHaveLength(0);
  });

  it("objeto que reaparece apos desaparecer ganha novo ID", () => {
    const r = new RastreadorObjetos();
    r.processar([pessoa()], 1000);
    r.processar([pessoa()], 1100);
    r.processar([], 1200);
    r.processar([], 1300);
    r.processar([], 1400);
    const _volta = r.processar([pessoa()], 1500);
    const volta2 = r.processar([pessoa()], 1600);
    expect(volta2.eventos.map((e) => e.tipo)).toEqual(["aparicao"]);
    expect(volta2.objetos[0].id).toMatch(/^obj-/);
  });

  it("classes diferentes na mesma caixa nao se associam", () => {
    const r = new RastreadorObjetos();
    r.processar([pessoa()], 1000);
    r.processar([pessoa()], 1050);
    const f2 = r.processar([det("dog", { xmin: 0, ymin: 0, xmax: 100, ymax: 100 }, 0.9, "cachorro")], 1100);
    const f3 = r.processar([det("dog", { xmin: 0, ymin: 0, xmax: 100, ymax: 100 }, 0.9, "cachorro")], 1150);
    expect(f3.eventos.map((e) => e.tipo)).toEqual(["aparicao"]);
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
    r.processar([pessoa()], 2000);
    const f2 = r.processar([], 2000 + CONFIG_RASTREAMENTO_PADRAO.expiracaoMs + 1);
    expect(f2.eventos.map((e) => e.tipo)).toEqual(["desaparecimento"]);
    expect(f2.objetos).toHaveLength(0);
  });

  it("reiniciar limpa o estado e os IDs", () => {
    const r = new RastreadorObjetos();
    r.processar([pessoa()], 1000);
    r.reiniciar();
    const f = r.processar([pessoa()], 2000);
    expect(f.objetos[0].id).toMatch(/^obj-/);
    expect(f.objetos[0].framesVisto).toBe(1);
  });

  it("persistencia de aparicao filtra deteccoes isoladas", () => {
    const r = new RastreadorObjetos({ framesParaConfirmarAparicao: 2 });
    const f1 = r.processar([pessoa()], 1000);
    expect(f1.eventos).toEqual([]);
    const f2 = r.processar([pessoa()], 1100);
    expect(f2.eventos.map((e) => e.tipo)).toEqual(["aparicao"]);

    const r2 = new RastreadorObjetos({ framesParaConfirmarAparicao: 2, expiracaoMs: 1000, maxFramesAusente: 1 });
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
    r.processar([pessoa()], 1000);
    expect(r.processar([pessoa()], 1100).eventos.map((e) => e.tipo)).toEqual(["aparicao"]);
    const f2 = r.processar([pessoa()], 1200);
    const f3 = r.processar([pessoa()], 1300);
    expect(f2.eventos).toEqual([]);
    expect(f3.eventos).toEqual([]);
    expect(f3.objetos).toHaveLength(1);
    expect(f3.objetos[0].framesVisto).toBe(4);
  });

  it("oclusao parcial mantem a identidade do objeto", () => {
    const r = new RastreadorObjetos({ movimentoMinimoRelativo: 0.5 });
    r.processar([pessoa(0, 0)], 1000);
    r.processar([pessoa(0, 0)], 1000);
    // Metade inferior ocluida: caixa menor, ainda sobreposta.
    const ocluido = det("person", { xmin: 0, ymin: 0, xmax: 100, ymax: 60 }, 0.9, "pessoa");
    const f2 = r.processar([ocluido], 1100);
    expect(f2.objetos).toHaveLength(1);
    expect(f2.objetos[0].id).toMatch(/^obj-/);
    expect(f2.objetos[0].caixa.ymax).toBe(60);
    expect(f2.eventos.some((e) => e.tipo === "aparicao")).toBe(false);
  });

  it("objeto estatico durante ciclos lentos nao gera desaparecimento espurio", () => {
    const r = new RastreadorObjetos({ maxFramesAusente: 2, expiracaoMs: 3000 });
    r.processar([pessoa(0, 0)], 1000);
    expect(r.processar([pessoa(0, 0)], 2000).eventos.map((e) => e.tipo)).toEqual(["aparicao"]);
    // Ciclo lento: 4 segundos depois, objeto continua la
    const f2 = r.processar([pessoa(0, 0)], 5000);
    expect(f2.eventos).toEqual([]);
    expect(f2.objetos).toHaveLength(1);
    const objId = f2.objetos[0].id;
    expect(objId).toMatch(/^obj-/);
  });

  it("ausencia curta e' tolerada conforme configuracao", () => {
    const r = new RastreadorObjetos({ maxFramesAusente: 2, expiracaoMs: 10000 });
    r.processar([pessoa(0, 0)], 1000);
    r.processar([], 2000);
    const f3 = r.processar([pessoa(0, 0)], 3000);
    expect(f3.eventos.map((e) => e.tipo)).toEqual(["aparicao"]);
    expect(f3.objetos).toHaveLength(1);
    expect(f3.objetos[0].id).toBe("obj-1");
  });

  it("ruído pequeno nas caixas não quebra a identidade nem gera eventos extras", () => {
    const r = new RastreadorObjetos();
    r.processar([pessoa(0, 0)], 1000);
    // jitter de ~5px em todas as bordas, bem abaixo do limiar de movimento
    const ruidoso = det(
      "person",
      { xmin: 4, ymin: 6, xmax: 103, ymax: 97 },
      0.88,
      "pessoa"
    );
    const f2 = r.processar([ruidoso], 1100);
    const id = f2.objetos[0].id;
    const f3 = r.processar([pessoa(0, 0)], 1200);
    expect(f3.objetos).toHaveLength(1);
    expect(f3.objetos[0].id).toBe(id);
    expect(f3.eventos.filter((e) => e.tipo !== "aparicao")).toEqual([]);
  });

  it("ordem invertida das deteccoes mantém a associação correta", () => {
    const r = new RastreadorObjetos({ movimentoMinimoRelativo: 0.5 });
    r.processar([pessoa(0, 0), pessoa(300, 300)], 1000);
    const f1 = r.processar([pessoa(0, 0), pessoa(300, 300)], 1100);
    const ids = f1.objetos.map((o) => o.id);
    // ordem invertida: pessoa da direita vem primeiro
    const f2 = r.processar([pessoa(300, 300), pessoa(0, 0)], 1200);
    expect(f2.objetos).toHaveLength(2);
    expect(f2.objetos.map((o) => o.id).sort()).toEqual([...ids].sort());
    // sem movimento: nenhum evento de movimento
    expect(f2.eventos.filter((e) => e.tipo === "movimento")).toEqual([]);
  });

  it("associação é por maior sobreposicao, não por ordem de chegada", () => {
    const r = new RastreadorObjetos({ movimentoMinimoRelativo: 0.5 });
    r.processar([pessoa(0, 0)], 1000);
    r.processar([pessoa(0, 0)], 1100);
    const id = r.rastreados[0].id;
    // objeto novo à direita aparece ANTES da pessoa existente na lista
    const outra = det("person", { xmin: 400, ymin: 0, xmax: 500, ymax: 100 }, 0.9, "outra");
    const f2 = r.processar([outra, pessoa(0, 0)], 1200);
    expect(f2.objetos).toHaveLength(2);
    expect(f2.objetos.find((o) => o.caixa.xmin === 0)?.id).toBe(id);
    // nova aparece com confirmacao de 2 frames; no primeiro frame ainda nao emite
    expect(f2.eventos.filter((e) => e.tipo === "aparicao")).toEqual([]);
    const f3 = r.processar([outra, pessoa(0, 0)], 1300);
    expect(f3.eventos.filter((e) => e.tipo === "aparicao")).toHaveLength(1);
  });
});