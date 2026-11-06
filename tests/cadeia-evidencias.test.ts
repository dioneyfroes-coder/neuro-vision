import { describe, expect, it } from "vitest";
import { InterpretadorCiclo, type RequisicaoMultimodal } from "../public/interpretation/interpretador-ciclo";
import { MotorTemporalImpl } from "../public/temporal/motor-temporal";
import { estaIndisponivel, type ObservacaoFrame, type PacoteCiclo } from "../src/domain";

describe("cadeia de evidencias multiframe", () => {
  it("preserva tracks, imagens, eventos e intervalos ate a requisicao multimodal", async () => {
    const inicioMs = Date.parse("2026-11-02T10:00:00.000Z");
    const observacoesOriginais: ObservacaoFrame[] = Array.from({ length: 4 }, (_, indice) => {
      const deslocamento = indice * 0.01;
      const capturadoEmMs = indice * 500;
      const capturadoEm = new Date(inicioMs + capturadoEmMs).toISOString();
      const pontos = Array.from({ length: 17 }, () => ({
        x: 0.3 + deslocamento,
        y: 0.5,
        confianca: 0.9,
      }));
      const landmarks = Array.from({ length: 21 }, (_, ponto) => ({
        x: 0.7 + deslocamento + ponto * 0.001,
        y: 0.6 + ponto * 0.001,
      }));
      const xmin = 100 + indice * 20;

      return {
        sessionId: "sess-fase1",
        cycleId: "sess-fase1-c1",
        frameId: `sess-fase1-c1-f${indice}`,
        capturadoEm,
        capturadoEmMs,
        imagem: `data:image/jpeg;base64,FRAME${indice}`,
        deteccoes: {
          deteccoes: [
            {
              nome: "caneca",
              rotulo: "cup",
              score: 0.95,
              caixa: { xmin, ymin: 100, xmax: xmin + 100, ymax: 200 },
            },
          ],
          dimensoes: { largura: 1000, altura: 1000 },
        },
        pose: { pessoas: [{ pontos, confianca: 0.9 }] },
        maos: {
          maos: [
            {
              lateralidade: "esquerda",
              landmarks,
              gesto: { nome: "mao_aberta", confianca: 0.95 },
            },
          ],
        },
        metricas: {},
      };
    });

    const motor = new MotorTemporalImpl();
    const temporal = motor.processar(observacoesOriginais);
    const { observacoes, ...resumoTemporal } = temporal;
    const pacote: PacoteCiclo = {
      sessionId: "sess-fase1",
      cycleId: "sess-fase1-c1",
      iniciadoEm: observacoesOriginais[0].capturadoEm,
      observacoes,
      eventosTemporais: temporal.eventos,
      resumoTemporal,
      metricas: {},
    };

    let requisicao: RequisicaoMultimodal | undefined;
    const interpretador = new InterpretadorCiclo({
      enviar: async (req) => {
        requisicao = req;
        return {
          texto: '{"resumo":"evidencias recebidas","acoes":[],"evidencias":["sess-fase1-c1-f0"],"incertezas":[],"contradicoes":[]}',
          modelo: "modelo-teste",
        };
      },
    });
    await interpretador.interpretar(pacote);

    expect(requisicao).toBeDefined();
    const enviada = requisicao!;
    const frames = enviada.contexto.frames;
    expect(enviada.imagens).toEqual(observacoesOriginais.map((obs) => obs.imagem));
    expect(enviada.frameIds).toEqual(observacoesOriginais.map((obs) => obs.frameId));
    expect(frames.map((frame) => frame.capturadoEm)).toEqual(
      observacoesOriginais.map((obs) => obs.capturadoEm)
    );
    expect(frames.map((frame) => frame.offsetMs)).toEqual([0, 500, 1000, 1500]);

    const idsDeteccao = frames.map((frame) => frame.deteccoes[0].trackId);
    const idsPessoa = frames.map((frame) => frame.pessoas[0].trackId);
    const idsMao = frames.map((frame) => frame.maos[0].trackId);
    expect(new Set(idsDeteccao).size).toBe(1);
    expect(new Set(idsPessoa).size).toBe(1);
    expect(new Set(idsMao).size).toBe(1);
    expect(idsDeteccao[0]).toBeDefined();
    expect(idsPessoa[0]).toBeDefined();
    expect(idsMao[0]).toBeDefined();

    for (const tipo of ["objeto", "pessoa", "mao"] as const) {
      const movimentos = frames.slice(1).map((frame) => frame.movimento.find((item) => item.tipo === tipo));
      expect(movimentos.every((movimento) => movimento?.intervaloMs === 500)).toBe(true);
    }

    expect(
      frames.slice(1).every((frame) =>
        frame.movimento.some((movimento) => movimento.tipo === "objeto" && movimento.trackId === idsDeteccao[0])
      )
    ).toBe(true);
    expect(
      enviada.contexto.eventosTemporais.some(
        (evento) => evento.tipo === "movimento_objeto" && evento.trackId === idsDeteccao[0]
      )
    ).toBe(true);

    // O enriquecimento acontece por copia; os resultados brutos do detector
    // continuam sem IDs mutados.
    expect(
      observacoesOriginais.every(
        (obs) =>
          !estaIndisponivel(obs.deteccoes) &&
          !obs.deteccoes.deteccoes[0].entidadeId &&
          !estaIndisponivel(obs.pose) &&
          !obs.pose.pessoas[0].entidadeId &&
          !estaIndisponivel(obs.maos) &&
          !obs.maos.maos[0].entidadeId
      )
    ).toBe(true);
  });
});
