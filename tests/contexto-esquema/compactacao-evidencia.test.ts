import { describe, expect, it } from "vitest";
import type { EventoTemporal } from "../../src/domain";
import {
  montarContextoCiclo,
  tamanhoBytesUtf8,
} from "../../public/interpretation/contexto";
import { KEYPOINTS_ESSENCIAIS } from "../../public/interpretation/esquema";
import {
  observacao,
  pacote,
} from "../helpers/contexto-esquema";

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

  it("ordena por proximidade e registra objetos podados como evidencia reduzida", () => {
    const distante = {
      nome: "livro",
      rotulo: "book",
      score: 0.9,
      caixa: { xmin: 185, ymin: 375, xmax: 195, ymax: 385 },
    };
    const pertoCorpo = {
      nome: "garfo",
      rotulo: "fork",
      score: 0.6,
      caixa: { xmin: 55, ymin: 155, xmax: 65, ymax: 165 },
    };
    const pertoMao = {
      nome: "copo",
      rotulo: "cup",
      score: 0.7,
      caixa: { xmin: 95, ymin: 235, xmax: 105, ymax: 245 },
    };
    const o = observacao({
      deteccoes: {
        deteccoes: [distante, pertoCorpo, pertoMao],
        dimensoes: { largura: 200, altura: 400 },
      },
      nsfw: {
        marcacoes: [
          { rotulo: "porn", score: 0.9, caixa: { xmin: 20, ymin: 40, xmax: 100, ymax: 200 } },
        ],
      },
    });
    const confirmado = evento({
      eventoId: "e-evidencia",
      estado: "confirmado",
      frameIds: ["f1"],
    });

    const completo = montarContextoCiclo(pacote([o], [confirmado])).contexto;
    expect(completo.frames[0].deteccoes.map((d) => d.rotulo)).toEqual([
      "cup",
      "fork",
      "book",
    ]);
    expect(completo.frames[0].deteccoes[0].proximidade?.prioridade).toBe("mao");
    expect(completo.frames[0].deteccoes[1].proximidade?.prioridade).toBe("corpo");

    const { contexto } = montarContextoCiclo(pacote([o], [confirmado]), {
      maxBytesContexto: tamanhoBytesUtf8(completo) - 700,
    });
    expect(contexto.frames[0].deteccoes.map((d) => d.rotulo)).toEqual(["cup"]);
    expect(contexto.deteccoesReduzidas?.map((g) => g.rotulo)).toContain("book");
    expect(
      contexto.truncamento?.gruposRemovidos.some((g) => g.grupo === "deteccoes_reduzidas")
    ).toBe(true);
    // NSFW e a unica evidencia do evento confirmado nunca entram na poda.
    expect(contexto.frames[0].nsfw).toHaveLength(1);
    expect(contexto.eventosTemporais.find((e) => e.eventoId === "e-evidencia")?.evidencias).toEqual([
      "f1",
    ]);
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