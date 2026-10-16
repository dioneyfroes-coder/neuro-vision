import { describe, expect, it } from "vitest";
import {
  criarCycleId,
  criarEventoId,
  criarFrameId,
  criarSessionId,
  estaIndisponivel,
  deteccaoDeLegado,
  deteccaoParaLegado,
  eventoTemporalParaLegado,
  indisponivel,
  uuid,
} from "../src/domain";
import type { EventoTemporal, ObservacaoFrame, PacoteCiclo } from "../src/domain";

describe("ids de dominio", () => {
  it("gera session/cycle/frame ids com hierarquia rastreavel", () => {
    const sessao = criarSessionId();
    expect(sessao).toHaveLength(8);
    const ciclo = criarCycleId(sessao, 1);
    const frame = criarFrameId(ciclo, 0);
    expect(ciclo).toBe(`${sessao}-c1`);
    expect(frame).toBe(`${sessao}-c1-f0`);
  });

  it("sessoes distintas produzem ids de evento distintos", () => {
    const a = criarEventoId("aaaa1111", "evt", 1);
    const b = criarEventoId("bbbb2222", "evt", 1);
    expect(a).not.toBe(b);
  });

  it("uuid e unico entre chamadas", () => {
    expect(uuid()).not.toBe(uuid());
  });
});

describe("indisponibilidade", () => {
  it("distingue falha de lista vazia valida", () => {
    const falha = indisponivel("pose", "timeout no estimador");
    expect(estaIndisponivel(falha)).toBe(true);
    expect(estaIndisponivel({ pessoas: [] })).toBe(false);
    expect(estaIndisponivel(null)).toBe(false);
    expect(falha.motivo).toContain("timeout");
  });
});

describe("adaptadores legados", () => {
  it("deteccao ida e volta preserva caixa e confianca", () => {
    const d = deteccaoDeLegado(
      deteccaoParaLegado({
        nome: "pessoa",
        rotulo: "person",
        score: 0.87,
        caixa: { xmin: 1, ymin: 2, xmax: 3, ymax: 4 },
      })
    );
    expect(d).toEqual({
      nome: "pessoa",
      rotulo: "person",
      score: 0.87,
      caixa: { xmin: 1, ymin: 2, xmax: 3, ymax: 4 },
    });
  });

  it("evento temporal vira evento legado com tipo e evidencia", () => {
    const evt: EventoTemporal = {
      eventoId: "evt-sess-1",
      sessionId: "sess",
      tipo: "aparicao",
      inicioEm: "2026-10-16T10:00:00.000Z",
      descricao: "apareceu pessoa",
      confianca: 0.8,
      origens: ["objetos"],
      frameIds: ["sess-c1-f0"],
      estado: "confirmado",
    };
    const legado = eventoTemporalParaLegado(evt);
    expect(legado.tipo).toBe("aparicao");
    expect(legado.id).toBe("evt-sess-1");
    expect(legado.frameId).toBe("sess-c1-f0");
    expect(legado.sessaoId).toBe("sess");
  });
});

describe("contratos de observacao e pacote", () => {
  const observacao: ObservacaoFrame = {
    sessionId: "sess0001",
    cycleId: "sess0001-c1",
    frameId: "sess0001-c1-f0",
    capturadoEm: "2026-10-16T10:00:00.000Z",
    capturadoEmMs: 1000,
    imagem: "data:image/jpeg;base64,AAAA",
    deteccoes: {
      deteccoes: [],
      dimensoes: { largura: 640, altura: 480 },
    },
    pose: indisponivel("pose", "estimador nao instalado"),
    maos: { maos: [] },
    metricas: { duracaoDeteccaoMs: 12 },
  };

  it("cada observacao carrega sessionId, cycleId e frameId", () => {
    expect(observacao.frameId.startsWith(observacao.cycleId)).toBe(true);
    expect(observacao.cycleId.startsWith(observacao.sessionId)).toBe(true);
    expect(observacao.capturadoEm).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(observacao.capturadoEmMs).toBeGreaterThan(0);
  });

  it("falha de um subsistema nao apaga os demais", () => {
    expect(estaIndisponivel(observacao.pose)).toBe(true);
    expect(estaIndisponivel(observacao.deteccoes)).toBe(false);
    expect(estaIndisponivel(observacao.maos)).toBe(false);
  });

  it("pacote do ciclo e a fronteira entre analise local e multimodal", () => {
    const pacote: PacoteCiclo = {
      sessionId: observacao.sessionId,
      cycleId: observacao.cycleId,
      iniciadoEm: "2026-10-16T10:00:00.000Z",
      observacoes: [observacao],
      eventosTemporais: [],
      resumoTemporal: { eventos: [], entidadesAtivas: 0 },
      metricas: {},
    };
    expect(pacote.observacoes[0].imagem).toBe(observacao.imagem);
    expect(pacote.resumoTemporal.eventos).toEqual([]);
  });
});
