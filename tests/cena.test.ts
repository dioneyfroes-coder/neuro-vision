import { describe, expect, it } from "vitest";
import {
  compararCena,
  construirReferencia,
  idMudancaCena,
  itemCenaValido,
  normalizarCaixaCena,
  type ItemCena,
  type ReferenciaCena,
} from "../src/domain/cena";

const AGORA = 1_700_000_000_000;
const SESSAO = "sessao-1";

function item(sobres: Partial<ItemCena> = {}): ItemCena {
  return {
    objetoId: "obj-1",
    rotulo: "cadeira",
    caixa: { xmin: 0.2, ymin: 0.2, xmax: 0.4, ymax: 0.4 },
    confirmacao: "confirmado",
    confianca: 0.9,
    observadoEmMs: AGORA,
    ...sobres,
  };
}

function referencia(itens: ItemCena[] = [item()]): ReferenciaCena {
  return construirReferencia({ sessaoId: SESSAO, itens, criadaEmMs: AGORA, quadros: 3 });
}

describe("normalizarCaixaCena e validacao", () => {
  it("converte pixels para [0,1], ordena extremos e corta fora da imagem", () => {
    expect(
      normalizarCaixaCena({ xmin: 20, ymin: 50, xmax: 120, ymax: 150 }, 200, 100)
    ).toEqual({ xmin: 0.1, ymin: 0.5, xmax: 0.6, ymax: 1 });
    expect(
      normalizarCaixaCena({ xmin: 120, ymin: 90, xmax: 20, ymax: 10 }, 200, 100)
    ).toEqual({ xmin: 0.1, ymin: 0.1, xmax: 0.6, ymax: 0.9 });
    expect(() => normalizarCaixaCena({ xmin: 0, ymin: 0, xmax: 1, ymax: 1 }, 0, 100)).toThrow();
  });

  it("recusa itens incompletos ou com confianca fora de [0,1]", () => {
    expect(itemCenaValido(item())).toBe(true);
    expect(itemCenaValido({ ...item(), confianca: 1.5 })).toBe(false);
    expect(itemCenaValido({ ...item(), caixa: { xmin: 0.9, ymin: 0, xmax: 0.1, ymax: 1 } })).toBe(false);
    expect(itemCenaValido({ ...item(), confirmacao: "outra" as ItemCena["confirmacao"] })).toBe(false);
    expect(() =>
      construirReferencia({ sessaoId: "../s", itens: [], criadaEmMs: AGORA })
    ).toThrow();
  });
});

describe("construirReferencia", () => {
  it("guarda um item por rotulo, escolhendo o de maior confiança", () => {
    const ref = referencia([
      item({ objetoId: "a", confianca: 0.6 }),
      item({ objetoId: "b", confianca: 0.95, caixa: { xmin: 0.5, ymin: 0.5, xmax: 0.6, ymax: 0.6 } }),
      item({ objetoId: "c", rotulo: "mesa", confianca: 0.8 }),
    ]);
    expect(ref).toMatchObject({ sessaoId: SESSAO, criadaEmMs: AGORA, quadros: 3 });
    expect(ref.itens.map((i) => [i.rotulo, i.objetoId])).toEqual([
      ["cadeira", "b"],
      ["mesa", "c"],
    ]);
  });

  it("desempate por objetoId torna a ordem do lote irrelevante", () => {
    const a = item({ objetoId: "a", confianca: 0.7 });
    const b = item({ objetoId: "b", confianca: 0.7 });
    const primeiro = construirReferencia({ sessaoId: SESSAO, itens: [a, b], criadaEmMs: AGORA });
    const segundo = construirReferencia({ sessaoId: SESSAO, itens: [b, a], criadaEmMs: AGORA });
    expect(primeiro).toEqual(segundo);
    expect(primeiro.itens[0].objetoId).toBe("a");
  });
});

describe("compararCena", () => {
  it("nao inventa mudanca quando a cena segue igual", () => {
    const ref = referencia();
    expect(compararCena(ref, [item()], AGORA + 100)).toEqual([]);
    // Falta de menção não é saída.
    expect(compararCena(ref, [], AGORA + 100)).toEqual([]);
  });

  it("detecta objeto movido com deslocamento e caixas de evidencia", () => {
    // Deslocamento de 0,18: IoU cai abaixo de 0,25, mas os centros seguem a
    // menos de 0,25 — é o caso que a regra classifica como "movido".
    const movido = item({
      caixa: { xmin: 0.38, ymin: 0.2, xmax: 0.58, ymax: 0.4 },
    });
    const [mudanca] = compararCena(referencia(), [movido], AGORA + 500);
    expect(mudanca).toMatchObject({
      tipo: "objeto_movido",
      observado: true,
      detectadoEmMs: AGORA + 500,
    });
    expect(mudanca.deslocamento).toBeCloseTo(0.18, 5);
    expect(mudanca.confianca).toBeGreaterThan(0);
    expect(mudanca.caixaAnterior).toEqual({ xmin: 0.2, ymin: 0.2, xmax: 0.4, ymax: 0.4 });
    expect(mudanca.caixaAtual).toEqual(movido.caixa);
  });

  it("nao afirma mudanca para o mesmo rotulo muito distante", () => {
    const longe = item({ caixa: { xmin: 0.8, ymin: 0.8, xmax: 0.9, ymax: 0.9 } });
    expect(compararCena(referencia(), [longe], AGORA + 500)).toEqual([]);
  });

  it("detecta alteracao de estado com a mesma posicao", () => {
    const [mudanca] = compararCena(
      referencia([item({ estadoObjeto: "fechado" })]),
      [item({ estadoObjeto: "aberto" })],
      AGORA + 200
    );
    expect(mudanca).toMatchObject({
      tipo: "estado_alterado",
      observado: true,
      estadoAnterior: "fechado",
      estadoAtual: "aberto",
    });
  });

  it("separa confirmado de possivel e de hipotese por ausencia", () => {
    const adicionado = compararCena(
      referencia(),
      [item(), item({ objetoId: "novo", rotulo: "mochila", confianca: 0.9 })],
      AGORA + 300
    );
    expect(adicionado).toMatchObject([
      { tipo: "objeto_adicionado", objetoId: "novo", observado: true, confianca: 0.9 },
    ]);

    const possivel = compararCena(
      referencia(),
      [item(), item({ objetoId: "novo", rotulo: "mochila", confirmacao: "possivel", confianca: 0.9 })],
      AGORA + 300
    );
    expect(possivel).toMatchObject([
      { tipo: "possivel_mudanca", observado: false, confianca: 0.6 },
    ]);

    const ausente = compararCena(
      referencia(),
      [item({ rotulo: "cadeira", confirmacao: "nao_observado", confianca: 1 })],
      AGORA + 300
    );
    expect(ausente).toMatchObject([
      { tipo: "objeto_removido", observado: false, confianca: 0.55 },
    ]);

    const ocluido = compararCena(
      referencia(),
      [item({ rotulo: "cadeira", confirmacao: "ocluido" })],
      AGORA + 300
    );
    expect(ocluido).toEqual([]);
  });

  it("mantém id estável entre comparacoes repetidas", () => {
    const ref = referencia();
    const atual = [item({ objetoId: "novo", rotulo: "mochila", confianca: 0.8 })];
    const primeira = compararCena(ref, atual, AGORA + 1);
    const segunda = compararCena(ref, atual, AGORA + 999);
    expect(primeira[0].mudancaId).toBe(segunda[0].mudancaId);
    expect(primeira[0].mudancaId).toBe(
      idMudancaCena(SESSAO, "objeto_adicionado", "novo", AGORA)
    );
  });

  it("respeita limites configuraveis e valida opcoes", () => {
    const ref = referencia();
    const deslocado = item({ caixa: { xmin: 0.35, ymin: 0.2, xmax: 0.55, ymax: 0.4 } });
    expect(compararCena(ref, [deslocado], AGORA, { distanciaMaxima: 0.1 })).toEqual([]);
    expect(() => compararCena(ref, [], AGORA, { iouMinimo: 2 })).toThrow();
  });
});
