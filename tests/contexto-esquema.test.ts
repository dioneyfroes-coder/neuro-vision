import { describe, expect, it } from "vitest";
import type { PacoteCiclo } from "../src/domain/cycle";
import type { EventoTemporal, ObservacaoFrame } from "../src/domain";
import { indisponivel } from "../src/domain/perception";
import { montarContextoCiclo } from "../public/interpretation/contexto";
import {
  calcularMovimento,
  estadoSubsistema,
  idsReais,
  NOMES_KEYPOINTS_COCO,
  validarReferencias,
  VERSAO_ESQUEMA_CONTEXTO,
} from "../public/interpretation/esquema";
import { InterpretadorCiclo } from "../public/interpretation/interpretador-ciclo";

/**
 * Fase 3 — schema versionado do contexto multimodal.
 *
 * Verifica que a evidencia observada (caixas normalizadas, keypoints nomeados,
 * maos, movimento, estado por subsistema) chega estruturada ao modelo, que cada
 * registro carrega `frameId`/timestamp/versao e que referencias citadas pelo
 * modelo sao validadas contra frames/eventos reais.
 */

/** 17 keypoints COCO sinteticos, com confianca decrescente por indice. */
function pontosCoco(baseX: number, baseY: number): ObservacaoFrame["pose"] {
  const pontos = NOMES_KEYPOINTS_COCO.map((_, i) => ({
    x: baseX + i * 0.01,
    y: baseY + i * 0.01,
    confianca: Math.max(0.1, 0.95 - i * 0.05),
  }));
  return { pessoas: [{ entidadeId: "pes-1", pontos, confianca: 0.9 }] };
}

function observacao(parcial: Partial<ObservacaoFrame> = {}): ObservacaoFrame {
  return {
    sessionId: "s1",
    cycleId: "s1-c1",
    frameId: "f1",
    capturadoEm: "2026-10-17T12:00:00.000Z",
    capturadoEmMs: 0,
    imagem: "img1",
    deteccoes: {
      deteccoes: [
        { nome: "pessoa", rotulo: "person", score: 0.8, caixa: { xmin: 10, ymin: 20, xmax: 110, ymax: 220 } },
      ],
      dimensoes: { largura: 200, altura: 400 },
    },
    pose: pontosCoco(0.2, 0.3),
    maos: {
      maos: [
        {
          entidadeId: "mao-1",
          lateralidade: "direita",
          gesto: { nome: "polegar_para_cima", confianca: 0.77 },
          landmarks: Array.from({ length: 21 }, (_, i) => ({ x: 0.5 + i * 0.001, y: 0.6 })),
        },
      ],
    },
    metricas: {
      subsistemas: {
        deteccao: { status: "ok", modelo: "yolov10n" },
        pose: { status: "ok", modelo: "yolov8n-pose" },
        maos: { status: "ok", modelo: "mediapipe" },
      },
    },
    ...parcial,
  };
}

function pacote(observacoes: ObservacaoFrame[], eventos: EventoTemporal[] = []): PacoteCiclo {
  return {
    sessionId: "s1",
    cycleId: "s1-c1",
    iniciadoEm: "2026-10-17T12:00:00.000Z",
    concluidoEm: "2026-10-17T12:00:01.000Z",
    observacoes,
    eventosTemporais: eventos,
    resumoTemporal: { eventos, entidadesAtivas: 1 },
    metricas: {},
  };
}

describe("schema versionado (contexto-1)", () => {
  it("carrega versao, frameId e timestamp em cada registro", () => {
    const { contexto } = montarContextoCiclo(pacote([observacao()]));
    expect(contexto.versao).toBe(VERSAO_ESQUEMA_CONTEXTO);
    expect(contexto.frames[0].versao).toBe(VERSAO_ESQUEMA_CONTEXTO);
    expect(contexto.frames[0].frameId).toBe("f1");
    expect(contexto.frames[0].capturadoEm).toBe("2026-10-17T12:00:00.000Z");
  });

  it("envia caixas normalizadas e score por deteccao", () => {
    const { contexto } = montarContextoCiclo(pacote([observacao()]));
    const det = contexto.frames[0].deteccoes[0];
    expect(det).toMatchObject({ label: "pessoa", rotulo: "person", score: 0.8 });
    expect(det.caixa).toEqual({ xmin: 0.05, ymin: 0.05, xmax: 0.55, ymax: 0.55 });
  });

  it("nomeia keypoints corporais e preserva confianca por ponto", () => {
    const { contexto } = montarContextoCiclo(pacote([observacao()]));
    const pessoa = contexto.frames[0].pessoas[0];
    expect(pessoa.trackId).toBe("pes-1");
    expect(pessoa.indice).toBe(1);
    const nomes = pessoa.keypoints.map((k) => k.nome);
    expect(nomes).toContain("nariz");
    expect(nomes).toContain("ombro_esquerdo");
    expect(pessoa.keypoints[0]).toHaveProperty("confianca");
  });

  it("envia lateralidade, gesto e landmarks compactos de mao", () => {
    const { contexto } = montarContextoCiclo(pacote([observacao()]));
    const mao = contexto.frames[0].maos[0];
    expect(mao.trackId).toBe("mao-1");
    expect(mao.lateralidade).toBe("direita");
    expect(mao.gesto).toEqual({ nome: "polegar_para_cima", confianca: 0.77 });
    expect(mao.landmarksCompletos).toBe(false);
    expect(mao.landmarks.length).toBeLessThanOrEqual(6);
    expect(mao.landmarks.map((l) => l.nome)).toContain("polegar_ponta");
  });

  it("envia os 21 landmarks quando landmarksCompletos=true", () => {
    const { contexto } = montarContextoCiclo(pacote([observacao()]), {}, {
      serializacao: { landmarksCompletos: true },
    });
    expect(contexto.frames[0].maos[0].landmarksCompletos).toBe(true);
    expect(contexto.frames[0].maos[0].landmarks).toHaveLength(21);
  });

  it("calcula movimento (deslocamento/direcao) entre frames da mesma entidade", () => {
    const o1 = observacao({ frameId: "f1", capturadoEmMs: 0 });
    const o2 = observacao({
      frameId: "f2",
      capturadoEmMs: 500,
      pose: {
        pessoas: [
          {
            entidadeId: "pes-1",
            pontos: NOMES_KEYPOINTS_COCO.map((_, i) => ({
              x: 0.2 + i * 0.01,
              y: 0.3 + i * 0.01,
              confianca: 0.9,
            })),
            confianca: 0.9,
          },
        ],
      },
    });
    const { contexto } = montarContextoCiclo(pacote([o1, o2]));
    const movimento = contexto.frames[1].movimento.find((m) => m.tipo === "pessoa");
    expect(movimento).toBeDefined();
    expect(movimento!.trackId).toBe("pes-1");
    expect(movimento!.intervaloMs).toBe(500);
    expect(movimento!.deslocamento).toBeGreaterThanOrEqual(0);
    // Sem movimento no primeiro frame (nao ha frame anterior).
    expect(contexto.frames[0].movimento).toEqual([]);
  });

  it("explicita o estado de cada subsistema (falha != ausencia)", () => {
    const o = observacao({
      pose: indisponivel("pose", "timeout"),
      maos: { maos: [] },
      metricas: {
        subsistemas: {
          deteccao: { status: "ok" },
          pose: { status: "indisponivel", motivoFalha: "timeout" },
          maos: { status: "sem_resultado" },
        },
      },
    });
    const { contexto } = montarContextoCiclo(pacote([o]));
    expect(contexto.frames[0].subsistemas.deteccao.status).toBe("ok");
    expect(contexto.frames[0].subsistemas.pose.status).toBe("indisponivel");
    expect(contexto.frames[0].subsistemas.pose.motivo).toBe("timeout");
    expect(contexto.frames[0].subsistemas.maos.status).toBe("sem_resultado");
    expect(contexto.indisponibilidades.some((i) => i.includes("pose indisponivel (timeout)"))).toBe(true);
  });

  it("envia eventos temporais com status, evidencias e gap", () => {
    const evento: EventoTemporal = {
      eventoId: "e1",
      sessionId: "s1",
      tipo: "braco_levantado",
      inicioEm: "2026-10-17T12:00:00.000Z",
      fimEm: "2026-10-17T12:00:00.500Z",
      descricao: "Braco levantado interrompido",
      origens: ["pose"],
      frameIds: ["f1", "f2"],
      estado: "incerto",
      confianca: 0.6,
      entidadeId: "pes-1",
      intervaloSemObservacaoMs: 1200,
    };
    const { contexto } = montarContextoCiclo(pacote([observacao()], [evento]));
    const serializado = contexto.eventosTemporais[0];
    expect(serializado).toMatchObject({
      eventoId: "e1",
      tipo: "braco_levantado",
      status: "incerto",
      trackId: "pes-1",
      confianca: 0.6,
      gapMs: 1200,
    });
    expect(serializado.evidencias).toEqual(["f1", "f2"]);
    expect(serializado.fimEm).toBe("2026-10-17T12:00:00.500Z");
  });

  it("descarta campos menos criticos antes de perder frameId/versao/estado", () => {
    const obs = Array.from({ length: 4 }, (_, i) =>
      observacao({
        frameId: `f${i}`,
        capturadoEmMs: i * 100,
        imagem: `img${i}`,
      })
    );
    const { contexto } = montarContextoCiclo(pacote(obs), { maxBytesContexto: 2000 });
    for (const frame of contexto.frames) {
      expect(frame.frameId).toBeTruthy();
      expect(frame.versao).toBe(VERSAO_ESQUEMA_CONTEXTO);
      expect(frame.subsistemas.deteccao.status).toBeDefined();
    }
  });
});

describe("estadoSubsistema", () => {
  it("deriva sem_resultado/ok/indisponivel do resultado e da telemetria", () => {
    expect(
      estadoSubsistema({ deteccoes: [] }, { status: "ok", modelo: "m" }, (r) => r.deteccoes.length === 0)
    ).toMatchObject({ status: "sem_resultado", modelo: "m" });
    expect(
      estadoSubsistema(
        { deteccoes: [{ nome: "p", rotulo: "p", score: 1, caixa: { xmin: 0, ymin: 0, xmax: 1, ymax: 1 } }] },
        undefined,
        (r) => r.deteccoes.length === 0
      ).status
    ).toBe("ok");
    expect(
      estadoSubsistema(indisponivel("pose", "falhou"), { modelo: "m" }, () => true)
    ).toMatchObject({ status: "indisponivel", motivo: "falhou" });
    expect(estadoSubsistema(undefined, { status: "nao_carregado" }, () => true).status).toBe(
      "nao_carregado"
    );
  });
});

describe("calcularMovimento", () => {
  it("nao gera movimento sem posicao anterior nem entidade rastreada", () => {
    const resultado = calcularMovimento(observacao(), new Map(), 2);
    expect(resultado.movimentos).toEqual([]);
    expect(resultado.posicoes.size).toBeGreaterThan(0);
  });

  it("ignora entidades sem trackId", () => {
    const semId = observacao({
      pose: { pessoas: [{ pontos: NOMES_KEYPOINTS_COCO.map(() => ({ x: 0.5, y: 0.5 })) }] },
      maos: { maos: [] },
    });
    const resultado = calcularMovimento(semId, new Map(), 2);
    expect(resultado.movimentos).toEqual([]);
  });
});

describe("validarReferencias", () => {
  const contexto = montarContextoCiclo(
    pacote([observacao({ frameId: "f1" })], [
      {
        eventoId: "e1",
        sessionId: "s1",
        tipo: "aparicao",
        inicioEm: "2026-10-17T12:00:00.000Z",
        descricao: "Aparicao",
        origens: ["objetos"],
        frameIds: ["f1"],
        estado: "confirmado",
      },
    ])
  ).contexto;

  it("aceita frameIds/eventoIds reais e resolve indice numerico", () => {
    const { validas, invalidas } = validarReferencias(contexto, ["f1", "e1", "Imagem 1", "1"]);
    expect(validas).toEqual(["f1", "e1"]);
    expect(invalidas).toEqual([]);
  });

  it("rejeita referencias inexistentes sem fundir com as validas", () => {
    const { validas, invalidas } = validarReferencias(contexto, ["f1", "f99", "evento-x"]);
    expect(validas).toEqual(["f1"]);
    expect(invalidas).toEqual(["f99", "evento-x"]);
  });

  it("idsReais reune frames e eventos", () => {
    expect(idsReais(contexto)).toEqual(new Set(["f1", "e1"]));
  });
});

describe("InterpretadorCiclo valida referencias do modelo", () => {
  it("remove evidencias inexistentes e as expõe em evidenciasInvalidas", async () => {
    const interpreter = new InterpretadorCiclo({
      enviar: async () => ({
        texto:
          '{"resumo":"x","acoes":[{"descricao":"y","evidencias":["f1","fantasma"]}],' +
          '"evidencias":["f1","inventado"],"incertezas":[],"contradicoes":[]}',
        modelo: "m",
      }),
    });
    const res = await interpreter.interpretar(pacote([observacao({ frameId: "f1" })]));
    expect(res.evidencias).toEqual(["f1"]);
    expect(res.evidenciasInvalidas).toEqual(["inventado"]);
    expect(res.acoes[0].evidencias).toEqual(["f1"]);
    expect(res.acoes[0].evidenciasInvalidas).toEqual(["fantasma"]);
  });

  it("normaliza 'Imagem 1' para o frameId real", async () => {
    const interpreter = new InterpretadorCiclo({
      enviar: async () => ({
        texto:
          '{"resumo":"x","acoes":[],"evidencias":["Imagem 1"],"incertezas":[],"contradicoes":[]}',
        modelo: "m",
      }),
    });
    const res = await interpreter.interpretar(pacote([observacao({ frameId: "f1" })]));
    expect(res.evidencias).toEqual(["f1"]);
  });
});
