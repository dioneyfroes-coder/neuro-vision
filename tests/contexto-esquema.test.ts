import { describe, expect, it } from "vitest";
import type { PacoteCiclo } from "../src/domain/cycle";
import type { EventoTemporal, ObservacaoFrame } from "../src/domain";
import { indisponivel } from "../src/domain/perception";
import { montarContextoCiclo, tamanhoBytesUtf8 } from "../public/interpretation/contexto";
import {
  calcularMovimento,
  estadoSubsistema,
  idsReais,
  KEYPOINTS_ESSENCIAIS,
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
    resumoTemporal: {
      eventos,
      tracksAtivos: 1,
      pessoasAtivas: 1,
      maosAtivas: 0,
      objetosAtivos: 0,
    },
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
    // A geometria usa os 21 landmarks brutos, mesmo no modo compacto.
    expect(mao.geometria).toBeDefined();
    expect(mao.geometria?.dedos).toHaveLength(5);
    expect(mao.geometria?.totalEstendidos).toBe(5);
    expect(mao.geometria?.configuracao).toBe("todos");
  });

  it("envia os 21 landmarks quando landmarksCompletos=true", () => {
    const { contexto } = montarContextoCiclo(pacote([observacao()]), {}, {
      serializacao: { landmarksCompletos: true },
    });
    expect(contexto.frames[0].maos[0].landmarksCompletos).toBe(true);
    expect(contexto.frames[0].maos[0].landmarks).toHaveLength(21);
    expect(contexto.frames[0].maos[0].geometria?.totalEstendidos).toBe(5);
  });

  it("permite desligar a geometria da mao na serializacao", () => {
    const { contexto } = montarContextoCiclo(pacote([observacao()]), {}, {
      serializacao: { geometriaMao: false },
    });
    expect(contexto.frames[0].maos[0].geometria).toBeUndefined();
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
      ultimaEvidenciaEm: "2026-10-17T12:00:00.500Z",
      ultimaObservacaoEm: "2026-10-17T12:00:00.800Z",
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
    // Evidencia e observacao sao explicitas e distintas: o sinal parou antes da
    // observacao da entidade.
    expect(serializado.ultimaEvidenciaEm).toBe("2026-10-17T12:00:00.500Z");
    expect(serializado.ultimaObservacaoEm).toBe("2026-10-17T12:00:00.800Z");
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

  it("preserva marcacoes NSFW normalizadas e o estado do subsistema", () => {
    const o = observacao({
      nsfw: {
        marcacoes: [
          {
            rotulo: "porn",
            score: 0.8765,
            caixa: { xmin: 20, ymin: 40, xmax: 100, ymax: 200 },
          },
        ],
        modelo: "erax_nsfw_yolo11n",
      },
      metricas: {
        subsistemas: {
          deteccao: { status: "ok" },
          pose: { status: "ok" },
          maos: { status: "ok" },
          nsfw: { status: "ok", modelo: "erax_nsfw_yolo11n" },
        },
      },
    });
    const { contexto } = montarContextoCiclo(pacote([o]));
    expect(contexto.frames[0].subsistemas.nsfw).toMatchObject({ status: "ok" });
    expect(contexto.frames[0].nsfw).toEqual([
      {
        rotulo: "porn",
        score: 0.88,
        caixa: { xmin: 0.1, ymin: 0.1, xmax: 0.5, ymax: 0.5 },
      },
    ]);
  });

  it("nunca descarta marcacoes NSFW ao reduzir o contexto por bytes", () => {
    const o = observacao({
      frameId: "f-nsfw",
      nsfw: {
        marcacoes: [
          {
            rotulo: "porn",
            score: 0.9,
            caixa: { xmin: 20, ymin: 40, xmax: 100, ymax: 200 },
          },
        ],
      },
      metricas: {
        subsistemas: {
          deteccao: { status: "ok" },
          pose: { status: "ok" },
          maos: { status: "ok" },
          nsfw: { status: "ok" },
        },
      },
    });
    // Teto bem abaixo do contexto completo: todas as reducoes nao-NSFW rodam.
    const { contexto } = montarContextoCiclo(pacote([o]), { maxBytesContexto: 400 });
    expect(contexto.frames[0].nsfw).toEqual([
      {
        rotulo: "porn",
        score: 0.9,
        caixa: { xmin: 0.1, ymin: 0.1, xmax: 0.5, ymax: 0.5 },
      },
    ]);
    expect(contexto.frames[0].subsistemas.nsfw?.status).toBe("ok");
  });
});

describe("limite de contexto em bytes UTF-8 (P2.3)", () => {
  it("mede bytes UTF-8, nao unidades de string", () => {
    const valor = { texto: "ação 🙌" };
    const texto = JSON.stringify(valor);
    expect(tamanhoBytesUtf8(valor)).toBe(new TextEncoder().encode(texto).length);
    // Acentos e emoji ocupam mais bytes do que unidades de string.
    expect(tamanhoBytesUtf8(valor)).toBeGreaterThan(texto.length);
  });

  it("nao registra limite quando o contexto cabe", () => {
    const { contexto } = montarContextoCiclo(pacote([observacao()]));
    expect(contexto.limiteContexto).toBeUndefined();
    expect(tamanhoBytesUtf8(contexto)).toBeLessThanOrEqual(16_000);
  });

  it("registra explicitamente quando o contexto nao cabe apos as reducoes", () => {
    const { contexto } = montarContextoCiclo(pacote([observacao()]), {
      maxBytesContexto: 60,
    });
    expect(contexto.limiteContexto?.excedeu).toBe(true);
    expect(contexto.limiteContexto?.maxBytes).toBe(60);
    // `bytes` e medido antes do proprio registro de limite.
    expect(contexto.limiteContexto!.bytes).toBeGreaterThan(60);
  });

  it("ao reduzir landmarks completos, deixa de afirmar landmarksCompletos", () => {
    const obs = Array.from({ length: 4 }, (_, i) =>
      observacao({ frameId: `f${i}`, capturadoEmMs: i * 100 })
    );
    const { contexto } = montarContextoCiclo(pacote(obs), { maxBytesContexto: 800 }, {
      serializacao: { landmarksCompletos: true },
    });
    for (const frame of contexto.frames) {
      for (const mao of frame.maos) {
        expect(mao.landmarks.length).toBeLessThanOrEqual(6);
        expect(mao.landmarksCompletos).toBe(false);
      }
    }
  });
});

describe("Fase 3 — compactacao preserva a evidencia", () => {
  function evento(parcial: Partial<EventoTemporal> & Pick<EventoTemporal, "eventoId">): EventoTemporal {
    return {
      sessionId: "s1",
      tipo: "gesto_detectado",
      inicioEm: "2026-10-17T12:00:00.000Z",
      descricao: "Evento de teste",
      origens: ["maos"],
      frameIds: ["f1"],
      estado: "confirmado",
      ...parcial,
    };
  }

  it("preserva ombros, cotovelos, pulsos e quadris ao reduzir keypoints", () => {
    const { contexto } = montarContextoCiclo(pacote([observacao()]), {
      maxBytesContexto: 1200,
    });
    const nomes = contexto.frames[0].pessoas[0].keypoints.map((k) => k.nome);
    for (const essencial of KEYPOINTS_ESSENCIAIS) {
      expect(nomes).toContain(essencial);
    }
  });

  it("registra truncamento quando reduz e ainda cabe no teto", () => {
    const opcoes = { serializacao: { landmarksCompletos: true as const } };
    const completo = montarContextoCiclo(pacote([observacao()]), {}, opcoes).contexto;
    const bytesCompletos = tamanhoBytesUtf8(completo);

    const { contexto } = montarContextoCiclo(
      pacote([observacao()]),
      { maxBytesContexto: bytesCompletos - 400 },
      opcoes
    );

    expect(contexto.truncamento?.ocorreu).toBe(true);
    expect(contexto.truncamento!.bytesAntes).toBe(bytesCompletos);
    expect(contexto.truncamento!.gruposRemovidos.length).toBeGreaterThan(0);
    expect(contexto.limiteContexto).toBeUndefined();
    expect(tamanhoBytesUtf8(contexto)).toBeLessThanOrEqual(contexto.truncamento!.maxBytes);
  });

  it("preserva gesto/geometria e eventos confirmados, podando os nao confirmados", () => {
    const confirmado = evento({
      eventoId: "e-confirmado",
      estado: "confirmado",
      frameIds: ["f1"],
      motivoEncerramento: "sem_sinal",
      continuidadeValida: true,
      evidencias: ["geometria:todos"],
    });
    const candidato = evento({
      eventoId: "e-candidato",
      estado: "candidato",
      frameIds: ["f1"],
      descricao: "Hipotese ainda nao confirmada",
    });
    const { contexto } = montarContextoCiclo(pacote([observacao()], [confirmado, candidato]), {
      maxBytesContexto: 1400,
    });

    const mao = contexto.frames[0].maos[0];
    expect(mao.gesto).toEqual({ nome: "polegar_para_cima", confianca: 0.77 });
    expect(mao.geometria?.dedos).toHaveLength(5);
    expect(mao.geometria?.totalEstendidos).toBe(5);

    const preservado = contexto.eventosTemporais.find((e) => e.eventoId === "e-confirmado");
    expect(preservado).toBeDefined();
    expect(preservado?.evidencias).toEqual(["f1"]);
    expect(preservado?.motivoEncerramento).toBe("sem_sinal");
    expect(preservado?.continuidadeValida).toBe(true);
    expect(preservado?.evidenciasTextuais).toEqual(["geometria:todos"]);
    expect(contexto.eventosTemporais.some((e) => e.eventoId === "e-candidato")).toBe(false);
    expect(
      contexto.truncamento?.gruposRemovidos.some(
        (grupo) => grupo.grupo === "eventos_nao_confirmados" && grupo.removidos === 1
      )
    ).toBe(true);
  });

  it("nunca perde silenciosamente a unica evidencia de um evento confirmado", () => {
    const confirmado = evento({
      eventoId: "e-unica",
      estado: "confirmado",
      frameIds: ["f-unica"],
    });
    const { contexto } = montarContextoCiclo(pacote([observacao()], [confirmado]), {
      maxBytesContexto: 700,
    });
    const preservado = contexto.eventosTemporais.find((e) => e.eventoId === "e-unica");
    expect(preservado?.evidencias).toEqual(["f-unica"]);
    // Se o evento saiu, o payload precisa declarar a poda; aqui ele permanece.
    expect(contexto.truncamento?.ocorreu).toBe(true);
  });

  it("mantem a ligacao entre imagens, frames e frameId apos a compactacao", () => {
    const obs = Array.from({ length: 4 }, (_, i) =>
      observacao({ frameId: `f${i}`, capturadoEmMs: i * 100, imagem: `img${i}` })
    );
    const { imagens, contexto } = montarContextoCiclo(pacote(obs), {
      maxBytesContexto: 1600,
    });
    expect(contexto.frames).toHaveLength(imagens.length);
    expect(contexto.frames.map((f) => f.frameId)).toEqual(["f0", "f1", "f2", "f3"]);
    expect(contexto.frames.map((f) => f.indice)).toEqual([1, 2, 3, 4]);
    contexto.frames.forEach((frame, i) => {
      expect(frame.frameId).toBe(`f${i}`);
      expect(imagens[i]).toBe(`img${i}`);
    });
  });

  it("snapshot do payload multimodal", () => {
    const confirmado = evento({
      eventoId: "e-snapshot",
      estado: "encerrado",
      frameIds: ["f1"],
      fimEm: "2026-10-17T12:00:00.500Z",
      motivoEncerramento: "sem_sinal",
      continuidadeValida: true,
      evidencias: ["geometria:todos"],
    });
    const { imagens, contexto } = montarContextoCiclo(
      pacote([observacao()], [confirmado]),
      {},
      { serializacao: { landmarksCompletos: true } }
    );
    expect({ imagens, contexto }).toMatchSnapshot();
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

  it("idsReais reune frames, eventos e frames de evidencia dos eventos", () => {
    expect(idsReais(contexto)).toEqual(new Set(["f1", "e1"]));
    const comEvidenciaForaDaAmostra = montarContextoCiclo(
      pacote([observacao({ frameId: "f1" })], [
        {
          eventoId: "e2",
          sessionId: "s1",
          tipo: "gesto_detectado",
          inicioEm: "2026-10-17T12:00:00.000Z",
          descricao: "Gesto",
          origens: ["maos"],
          frameIds: ["f-fora-da-amostra"],
          estado: "confirmado",
        },
      ])
    ).contexto;
    expect(validarReferencias(comEvidenciaForaDaAmostra, ["f-fora-da-amostra"]).validas).toEqual([
      "f-fora-da-amostra",
    ]);
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

  it("repassa a serializacao experimental de maos (21 landmarks + geometria)", async () => {
    let landmarks: number | undefined;
    let completos: boolean | undefined;
    let geometria: number | undefined;
    const interpreter = new InterpretadorCiclo({
      enviar: async (requisicao) => {
        const mao = requisicao.contexto.frames[0].maos[0];
        landmarks = mao.landmarks.length;
        completos = mao.landmarksCompletos;
        geometria = mao.geometria?.dedos.length;
        return {
          texto:
            '{"resumo":"x","acoes":[],"evidencias":[],"incertezas":[],"contradicoes":[]}',
          modelo: "m",
        };
      },
      serializacao: { landmarksCompletos: true },
    });
    await interpreter.interpretar(pacote([observacao({ frameId: "f1" })]));
    expect(landmarks).toBe(21);
    expect(completos).toBe(true);
    expect(geometria).toBe(5);
  });
});
