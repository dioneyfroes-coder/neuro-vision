import { describe, expect, it } from "vitest";
import type { EventoTemporal } from "../../src/domain";
import { indisponivel } from "../../src/domain/perception";
import { montarContextoCiclo } from "../../public/interpretation/contexto";
import {
  NOMES_KEYPOINTS_COCO,
  VERSAO_ESQUEMA_CONTEXTO,
} from "../../public/interpretation/esquema";
import {
  observacao,
  pacote,
} from "../helpers/contexto-esquema";

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

  it("serializa pessoaTrackId quando a mao foi associada a uma pessoa", () => {
    const { contexto } = montarContextoCiclo(
      pacote([
        observacao({
          maos: {
            maos: [
              {
                entidadeId: "mao-1",
                pessoaEntidadeId: "pes-1",
                lateralidade: "direita",
                landmarks: [{ x: 0.5, y: 0.6 }],
              },
            ],
          },
        }),
      ])
    );
    expect(contexto.frames[0].maos[0]).toMatchObject({
      trackId: "mao-1",
      pessoaTrackId: "pes-1",
    });

    // Sem associacao, o campo nao e inventado.
    const { contexto: semAssociacao } = montarContextoCiclo(pacote([observacao()]));
    expect(semAssociacao.frames[0].maos[0].pessoaTrackId).toBeUndefined();
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