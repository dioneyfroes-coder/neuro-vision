import { describe, expect, it } from "vitest";
import type { PacoteCiclo } from "../../src/domain/cycle";
import type {
  EventoTemporal,
  ObservacaoFrame,
} from "../../src/domain";
import { indisponivel } from "../../src/domain/perception";
import { montarContextoCiclo } from "../../public/interpretation/contexto";
import { OBS_BASE, PACOTE } from "../helpers/interpretacao-payload";

describe("montarContextoCiclo", () => {
  it("mantem as imagens na ordem e associa indice 1-based", () => {
    const o1: ObservacaoFrame = { ...OBS_BASE, frameId: "f1", capturadoEmMs: 0, imagem: "img1" };
    const o2: ObservacaoFrame = { ...OBS_BASE, frameId: "f2", capturadoEmMs: 500, imagem: "img2" };
    const pacote: PacoteCiclo = { ...PACOTE, observacoes: [o1, o2] };
    const { imagens, contexto } = montarContextoCiclo(pacote, { maxImagens: 4 });
    expect(imagens).toEqual(["img1", "img2"]);
    expect(contexto.frames).toHaveLength(2);
    expect(contexto.frames[0].indice).toBe(1);
    expect(contexto.frames[0].frameId).toBe("f1");
    expect(contexto.frames[1].indice).toBe(2);
    expect(contexto.frames[1].frameId).toBe("f2");
    expect(contexto.janelaMs).toBe(500);
  });

  it("ordena os frames cronologicamente e sinaliza indisponibilidade", () => {
    const o1: ObservacaoFrame = { ...OBS_BASE, frameId: "f1", capturadoEmMs: 500, imagem: "img1", pose: indisponivel("pose", "timeout") };
    const o2: ObservacaoFrame = { ...OBS_BASE, frameId: "f2", capturadoEmMs: 0, imagem: "img2" };
    const pacote: PacoteCiclo = { ...PACOTE, observacoes: [o1, o2] };
    const { imagens, contexto } = montarContextoCiclo(pacote);
    expect(imagens).toEqual(["img2", "img1"]);
    expect(contexto.indisponibilidades.some((i) => i.includes("pose indisponivel (timeout)"))).toBe(true);
  });

  it("limita o numero de imagens e arredonda dados numericos", () => {
    const obs = Array.from({ length: 5 }, (_, i) => ({
      ...OBS_BASE,
      frameId: `f${i}`,
      capturadoEmMs: i * 100,
      imagem: `img${i}`,
      deteccoes: {
        deteccoes: [
          { nome: "pessoa", rotulo: "person", score: 0.91234, caixa: { xmin: 0, ymin: 0, xmax: 100, ymax: 100 } },
        ],
        dimensoes: { largura: 200, altura: 200 },
      },
    }));
    const pacote: PacoteCiclo = { ...PACOTE, observacoes: obs };
    const { imagens, contexto } = montarContextoCiclo(pacote, { maxImagens: 3, decimais: 2 });
    expect(imagens).toHaveLength(3);
    // score arredondado a 2 decimais e caixa normalizada em [0,1]
    expect(contexto.frames[0].deteccoes[0].score).toBe(0.91);
    expect(contexto.frames[0].deteccoes[0].caixa).toEqual({
      xmin: 0,
      ymin: 0,
      xmax: 0.5,
      ymax: 0.5,
    });
  });

  it("sem dados locais (variante B) envia so imagens + cronologia", () => {
    const o1: ObservacaoFrame = { ...OBS_BASE, frameId: "f1", capturadoEmMs: 0, imagem: "img1" };
    const o2: ObservacaoFrame = { ...OBS_BASE, frameId: "f2", capturadoEmMs: 100, imagem: "img2" };
    const evento: EventoTemporal = {
      eventoId: "e1",
      sessionId: "s1",
      cycleId: "s1-c1",
      tipo: "gesto_detectado",
      inicioEm: "2026-10-17T12:00:00.000Z",
      descricao: "Gesto confirmado",
      origens: ["maos"],
      frameIds: ["f1"],
      estado: "confirmado",
    };
    const pacote: PacoteCiclo = {
      ...PACOTE,
      observacoes: [o1, o2],
      eventosTemporais: [evento],
    };
    const { imagens, contexto } = montarContextoCiclo(pacote, {}, { incluirDadosLocais: false });

    expect(imagens).toEqual(["img1", "img2"]);
    expect(contexto.versao).toBe("contexto-1");
    expect(contexto.frames[0]).toMatchObject({
      frameId: "f1",
      indice: 1,
      deteccoes: [],
      pessoas: [],
      maos: [],
      movimento: [],
    });
    expect(contexto.frames[0].subsistemas.deteccao.status).toBe("nao_carregado");
    expect(contexto.frames[1].offsetMs).toBe(100);
    expect(contexto.eventosTemporais).toEqual([]);
    expect(contexto.indisponibilidades).toEqual([]);
    expect(contexto.resumoTemporal.tracksAtivos).toBe(0);
    expect(contexto.resumoTemporal.pessoasAtivas).toBe(0);
    expect(contexto.resumoTemporal.maosAtivas).toBe(0);
    expect(contexto.resumoTemporal.objetosAtivos).toBe(0);
  });
});