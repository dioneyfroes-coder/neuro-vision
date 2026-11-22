import { describe, expect, it } from "vitest";
import {
  compararCena,
  construirReferencia,
  statusEvidenciaCena,
  statusEvidenciaEvento,
  type ItemCena,
} from "../src/domain";
import type { EventoVisual } from "../src/types";
import { WebcamCapture, type FonteCaptura } from "../public/capture/webcam-capture";
import { CONFIG_CAPTURA_PADRAO } from "../public/capture/webcam-capture";
import { converterEventoVisual } from "../public/temporal/motor-temporal-eventos";
import { RastreadorEntidades } from "../public/temporal/rastreador-entidades";

const AGORA = 1_700_000_000_000;

function item(sobres: Partial<ItemCena> = {}): ItemCena {
  return {
    objetoId: "obj-1",
    rotulo: "cadeira",
    caixa: { xmin: 0.1, ymin: 0.1, xmax: 0.3, ymax: 0.3 },
    confirmacao: "confirmado",
    confianca: 0.9,
    observadoEmMs: AGORA,
    ...sobres,
  };
}

describe("Fase 1 — status de evidência", () => {
  it("não transforma falha de percepção em desaparecimento", () => {
    expect(
      statusEvidenciaEvento({
        estado: "encerrado",
        motivoEncerramento: "sem_sinal",
        evidencias: ["inferencia_indisponivel"],
      })
    ).toBe("falha_percepcao");
  });

  it("não transforma oclusão em remoção", () => {
    expect(
      statusEvidenciaEvento({ estado: "encerrado", motivoEncerramento: "oclusao" })
    ).toBe("ocluido");
    expect(statusEvidenciaCena("ocluido")).toBe("ocluido");
    expect(statusEvidenciaCena("nao_confirmado")).toBe("desconhecido");
  });

  it("mantém hipótese separada de conclusão inferida", () => {
    expect(statusEvidenciaEvento({ estado: "provavel" })).toBe("possivel");
    expect(
      statusEvidenciaEvento({
        estado: "confirmado",
        tipo: "interacao_objeto",
        frameIds: ["f1", "f2"],
      })
    ).toBe("inferido");
    expect(statusEvidenciaEvento({ estado: "confirmado", frameIds: ["f1"] })).toBe("observado");
  });

  it("liga o evento ao frame que o originou e separa processamento de persistência", () => {
    const timestamp = "2026-11-22T10:00:00.000Z";
    const visual: EventoVisual = {
      id: "ev-1",
      timestamp,
      tipo: "aparicao",
      descricao: "objeto apareceu",
      origem: "detector",
    };
    const evento = converterEventoVisual(visual, "sess-1", "f1", "c1");
    expect(evento).not.toBeNull();
    expect(evento?.capturadoEmMs).toBe(Date.parse(timestamp));
    expect(evento?.inferidoEmMs).toBe(evento?.processadoEmMs);
    expect(evento?.statusEvidencia).toBe("observado");
    expect(evento?.persistidoEmMs).toBeUndefined();
  });
});

describe("Fase 1 — captura com timestamp do frame", () => {
  it("registra pedido e captura como instantes distintos", async () => {
    let relogio = 0;
    const fonte: FonteCaptura = {
      ativa: true,
      largura: 640,
      altura: 480,
      capturarQuadro: () => {
        relogio += 10;
        return { imagem: "data:image/jpeg;base64,A", thumb: "data:image/jpeg;base64,T" };
      },
      assinaturaDeCena: () => null,
    };
    const captura = new WebcamCapture(
      fonte,
      { ...CONFIG_CAPTURA_PADRAO, quadros: 2, intervaloMs: 100 },
      {
        agora: () => relogio,
        esperar: async (ms) => {
          relogio += ms;
        },
        agoraIso: () => "2026-11-22T10:00:00.000Z",
      }
    );

    const snapshots = await captura.capturar("sess-1");
    expect(snapshots.map((s) => s.solicitadoEmMs)).toEqual([0, 100]);
    expect(snapshots.map((s) => s.capturadoEmMs)).toEqual([10, 110]);
  });
});

describe("Fase 1 — identidade e inventário multi-instância", () => {
  it("mantém duas cadeiras da mesma classe como entidades separadas", () => {
    const referencia = construirReferencia({
      sessaoId: "sess-1",
      criadaEmMs: AGORA,
      itens: [
        item({ objetoId: "obj-a", instanciaId: "cadeira-esq" }),
        item({
          objetoId: "obj-b",
          instanciaId: "cadeira-dir",
          caixa: { xmin: 0.6, ymin: 0.1, xmax: 0.8, ymax: 0.3 },
        }),
      ],
    });
    expect(referencia.itens.map((i) => i.instanciaId)).toEqual(["cadeira-dir", "cadeira-esq"]);
    expect(referencia.itens.every((i) => i.statusEvidencia === "observado")).toBe(true);
  });

  it("preserva o contrato legado quando não há instanciaId", () => {
    const referencia = construirReferencia({
      sessaoId: "sess-1",
      criadaEmMs: AGORA,
      itens: [item({ objetoId: "a" }), item({ objetoId: "b", confianca: 0.95 })],
    });
    expect(referencia.itens).toHaveLength(1);
    expect(referencia.itens[0].objetoId).toBe("b");
  });

  it("não afirma remoção ao comparar várias instâncias da mesma classe", () => {
    const referencia = construirReferencia({
      sessaoId: "sess-1",
      criadaEmMs: AGORA,
      itens: [
        item({ objetoId: "obj-a", instanciaId: "cadeira-esq" }),
        item({
          objetoId: "obj-b",
          instanciaId: "cadeira-dir",
          caixa: { xmin: 0.6, ymin: 0.1, xmax: 0.8, ymax: 0.3 },
        }),
      ],
    });
    const mudancas = compararCena(
      referencia,
      [
        item({ objetoId: "obj-a", instanciaId: "cadeira-esq" }),
        item({
          objetoId: "obj-b",
          instanciaId: "cadeira-dir",
          caixa: { xmin: 0.6, ymin: 0.1, xmax: 0.8, ymax: 0.3 },
        }),
        item({
          objetoId: "obj-c",
          instanciaId: "cadeira-nova",
          caixa: { xmin: 0.1, ymin: 0.6, xmax: 0.3, ymax: 0.8 },
        }),
      ],
      AGORA + 100
    );
    expect(mudancas.map((m) => [m.tipo, m.objetoId])).toEqual([
      ["objeto_adicionado", "obj-c"],
    ]);
  });

  it("marca associação ambígua quando duas instâncias são igualmente prováveis", () => {
    const referencia = construirReferencia({
      sessaoId: "sess-1",
      criadaEmMs: AGORA,
      consolidacao: "instancia",
      itens: [
        item({ objetoId: "ref-a", estadoObjeto: "fechado" }),
        item({
          objetoId: "ref-b",
          estadoObjeto: "fechado",
          caixa: { xmin: 0.105, ymin: 0.1, xmax: 0.305, ymax: 0.3 },
        }),
      ],
    });
    const mudancas = compararCena(
      referencia,
      [
        item({ objetoId: "obs-a", estadoObjeto: "aberto" }),
        item({
          objetoId: "obs-b",
          estadoObjeto: "aberto",
          caixa: { xmin: 0.105, ymin: 0.1, xmax: 0.305, ymax: 0.3 },
        }),
      ],
      AGORA + 100
    );
    expect(mudancas.length).toBeGreaterThan(0);
    expect(mudancas.some((m) => m.associacao === "ambiga")).toBe(true);
    expect(mudancas.filter((m) => m.associacao === "ambiga").every((m) => m.statusEvidencia === "possivel")).toBe(true);
  });

  it("preserva o ID e marca ambiguidade na reidentificação após oclusão", () => {
    const rastreador = new RastreadorEntidades(
      {
        distanciaMaxima: 0.1,
        distanciaReassociacaoMaxima: 0.4,
        raioAmbiguidadeReassociacao: 0.7,
        maxFramesAusente: 0,
        maxTempoAusenteMs: 1000,
        alphaSuavizacao: 1,
      },
      "t"
    );
    const inicial = rastreador.atualizar([{ x: 0.1, y: 0.1, confianca: 0.9 }], 0);
    const id = inicial[0].entidadeId;
    rastreador.atualizar([], 100);
    const reidentificado = rastreador.atualizar(
      [{ x: 0.42, y: 0.1, confianca: 0.9 }],
      200
    );
    expect(reidentificado).toHaveLength(1);
    expect(reidentificado[0].entidadeId).toBe(id);
    expect(reidentificado[0].estadoIdentidade).toBe("ambiga");
    expect(reidentificado[0].historicoObservacoes).toHaveLength(2);
  });
});
