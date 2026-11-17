import { describe, expect, it } from "vitest";
import { indisponivel, naoAmostrado } from "../src/domain";
import type { EventoTemporal, ObservacaoFrame } from "../src/domain";
import { MotorTemporalImpl } from "../public/temporal/motor-temporal";

/**
 * Integracao da detectora de interacao no motor temporal real (Fase 4).
 *
 * Prova que deteccoes (em pixels) + maos (normalizadas) passam pelo rastreamento
 * de objetos e viram eventos `interacao_objeto`, que a proximidade isolada fica
 * em `provavel` e que so a combinacao de sobreposicao sustentada com o
 * deslocamento do objeto (com o mesmo `entidadeId`) confirma o contato.
 *
 * Tudo determinístico: relogio vem de `capturadoEmMs` e nao do relogio de parede.
 */
const BASE = 1_700_000_000_000;
const LARGURA = 100;
const ALTURA = 100;

interface OpcoesFrame {
  indice: number;
  /** Centro X normalizado do objeto. */
  objetoX: number;
  /** X normalizado do punho da mao. */
  maoX: number;
}

function frame(o: OpcoesFrame): ObservacaoFrame {
  const ms = o.indice * 100;
  const centroPx = o.objetoX * LARGURA;
  const pontos = Array.from({ length: 21 }, () => ({ x: o.maoX, y: 0.5 }));
  return {
    sessionId: "s1",
    cycleId: "c1",
    frameId: `f${o.indice}`,
    capturadoEm: new Date(BASE + ms).toISOString(),
    capturadoEmMs: ms,
    imagem: "data:,",
    deteccoes: {
      dimensoes: { largura: LARGURA, altura: ALTURA },
      deteccoes: [
        {
          nome: "garrafa",
          rotulo: "bottle",
          score: 0.9,
          // Caixa de 10 px = 0.1 normalizado; centro em `objetoX`.
          caixa: { xmin: centroPx - 5, ymin: 45, xmax: centroPx + 5, ymax: 55 },
        },
      ],
    },
    // Pose desativada: nao ha gesto/braco/movimento corporal; apenas maos e
    // objetos alimentam a detectora de interacao.
    pose: indisponivel("pose", "desativado"),
    maos: {
      dimensoes: { largura: LARGURA, altura: ALTURA },
      maos: [
        {
          lateralidade: "direita",
          landmarks: pontos,
          gesto: { nome: "agarra", confianca: 0.9 },
        },
      ],
    },
    metricas: {},
  };
}

function eventosInteracao(lista: EventoTemporal[]): EventoTemporal[] {
  return lista.filter((e) => e.tipo === "interacao_objeto");
}

describe("integracao de interacao no MotorTemporalImpl", () => {
  it("proximidade isolada atraves do motor fica em provavel, nunca confirmado", () => {
    const motor = new MotorTemporalImpl();
    // Mao a 0.14 do centro do objeto: dentro do raio (0.15), fora da caixa
    // (0.45..0.55 com margem 0.02 => 0.43..0.57). Nao ha sobreposicao.
    const resultado = motor.processar(
      Array.from({ length: 5 }, (_, i) =>
        frame({ indice: i, objetoX: 0.5, maoX: 0.64 })
      )
    );
    const interacoes = eventosInteracao(resultado.eventos);
    expect(interacoes.map((e) => e.estado)).toEqual(["incerto", "provavel"]);
    expect(interacoes.some((e) => e.estado === "confirmado")).toBe(false);
    expect(interacoes.at(-1)?.descricao).toMatch(/contato nao confirmado/);
  });

  it("sobreposicao sustentada e movimento do objeto confirmam contato com id estavel", () => {
    const motor = new MotorTemporalImpl();
    const frames = Array.from({ length: 4 }, (_, i) => {
      // A partir de f2 o objeto SE desloca 0.1 normalizado; a mao acompanha e
      // continua com o punho dentro da caixa. O rastreador preserva o objetoId
      // (distancia de 10 px << 80 px) e o maoId (0.1 << 0.25).
      const objetoX = i >= 2 ? 0.6 : 0.5;
      return frame({ indice: i, objetoX, maoX: objetoX });
    });
    const resultado = motor.processar(frames);
    const interacoes = eventosInteracao(resultado.eventos);
    expect(interacoes.map((e) => e.estado)).toEqual([
      "incerto",
      "provavel",
      "confirmado",
    ]);
    const confirmado = interacoes.at(-1)!;
    expect(confirmado.tipo).toBe("interacao_objeto");
    expect(confirmado.entidadeId).toBe(confirmado.participantes?.[1]);
    expect(confirmado.participantes).toHaveLength(2);
    expect(confirmado.origens).toEqual(["maos", "objetos"]);
    expect(confirmado.evidencias?.some((e) => e.startsWith("objeto_moveu:"))).toBe(true);
    expect(new Set(interacoes.map((e) => e.eventoId)).size).toBe(1);
    // O movimento do objeto gera tambem `movimento_objeto` no rastreador; o
    // evento de interacao e independente e nao deve ser confundido com ele.
    expect(resultado.eventos.some((e) => e.tipo === "movimento_objeto")).toBe(true);
  });

  it("sem dimensoes nas deteccoes o motor se abstem de classificar interacao", () => {
    const motor = new MotorTemporalImpl();
    const frames = Array.from({ length: 5 }, (_, i) => {
      const f = frame({ indice: i, objetoX: 0.5, maoX: 0.5 });
      if (!("indisponivel" in f.deteccoes)) {
        delete (f.deteccoes as { dimensoes?: unknown }).dimensoes;
      }
      return f;
    });
    const resultado = motor.processar(frames);
    expect(eventosInteracao(resultado.eventos)).toEqual([]);
  });

  it("frame sem amostragem de maos preserva a interacao em curso", () => {
    const motor = new MotorTemporalImpl();
    const frames = [
      frame({ indice: 0, objetoX: 0.5, maoX: 0.5 }),
      frame({ indice: 1, objetoX: 0.5, maoX: 0.5 }),
    ];
    const pulado = frame({ indice: 2, objetoX: 0.5, maoX: 0.5 });
    pulado.maos = naoAmostrado("maos");
    const resultado = motor.processar([...frames, pulado]);
    const interacoes = eventosInteracao(resultado.eventos);
    expect(interacoes.map((e) => e.estado)).toContain("provavel");
    expect(interacoes.some((e) => e.estado === "encerrado")).toBe(false);
  });
});
