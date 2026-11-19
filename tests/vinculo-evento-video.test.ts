import { describe, expect, it } from "vitest";
import {
  JANELA_EVIDENCIA_ANTES_MS,
  JANELA_EVIDENCIA_DEPOIS_MS,
  janelaEvento,
  vincularEventoASegmentos,
  vincularInstanteAosSegmentos,
  type VideoSegment,
} from "../src/domain";

/** Relogio nunca e lido: todos os instantes vem de numeros fixos injetados. */
const BASE = 1_700_000_000_000;
const iso = (ms: number) => new Date(ms).toISOString();

function segmento(
  segmentoId: string,
  inicioMs: number,
  fimMs: number,
  sequencia: number,
  extra: Partial<VideoSegment> = {}
): VideoSegment {
  return {
    segmentoId,
    sessaoId: "sess-1",
    sequencia,
    inicioEm: iso(inicioMs),
    inicioMs,
    fimEm: iso(fimMs),
    fimMs,
    duracaoMs: fimMs - inicioMs,
    quadros: 10,
    estado: "fechado",
    lacunas: [],
    ...extra,
  };
}

const segmentos = [
  segmento("seg-1", BASE, BASE + 1_000, 1),
  segmento("seg-2", BASE + 1_000, BASE + 2_000, 2),
  segmento("seg-3", BASE + 3_000, BASE + 4_000, 3),
];

describe("vinculo evento → video (Fase 5)", () => {
  it("janelaEvento usa o ponto de inicio quando fimEm ausente ou invalido", () => {
    expect(janelaEvento(iso(BASE), undefined)).toEqual({ inicioMs: BASE, fimMs: BASE });
    expect(janelaEvento(iso(BASE), "nao-e-data")).toEqual({ inicioMs: BASE, fimMs: BASE });
    expect(janelaEvento(iso(BASE), iso(BASE - 10))).toEqual({ inicioMs: BASE, fimMs: BASE });
    expect(janelaEvento("invalido")).toBeUndefined();
  });

  it("produz offset e duracao dentro do segmento que cobre o evento", () => {
    const refs = vincularEventoASegmentos(
      iso(BASE + 200),
      iso(BASE + 500),
      segmentos
    );
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      segmentoId: "seg-1",
      sessaoId: "sess-1",
      offsetMs: 200,
      ateMs: 500,
      duracaoTrechoMs: 300,
      incompleto: false,
    });
  });

  it("evento sobre a rotacao referencia os dois segmentos, com trecho util no segundo", () => {
    const refs = vincularEventoASegmentos(
      iso(BASE + 1_000),
      iso(BASE + 1_200),
      segmentos
    );
    expect(refs.map((ref) => ref.segmentoId)).toEqual(["seg-1", "seg-2"]);
    expect(refs[0]).toMatchObject({ offsetMs: 1_000, ateMs: 1_000, duracaoTrechoMs: 0 });
    expect(refs[1]).toMatchObject({ offsetMs: 0, ateMs: 200, duracaoTrechoMs: 200 });
  });

  it("evento em lacuna de gravacao nao ganha video inexistente", () => {
    expect(
      vincularEventoASegmentos(iso(BASE + 2_500), iso(BASE + 2_700), segmentos)
    ).toEqual([]);
  });

  it("sinaliza segmento incompleto e preserva lacunas em vez de esconde-las", () => {
    const lacuna = {
      inicioEm: iso(BASE + 400),
      inicioMs: BASE + 400,
      fimEm: iso(BASE + 600),
      fimMs: BASE + 600,
      duracaoMs: 200,
      motivo: "sem_quadros" as const,
    };
    const refs = vincularEventoASegmentos(iso(BASE + 300), iso(BASE + 700), [
      segmento("seg-i", BASE, BASE + 1_000, 1, {
        estado: "incompleto",
        lacunas: [lacuna],
      }),
    ]);
    expect(refs[0]).toMatchObject({
      incompleto: true,
      lacunas: [{ inicioMs: BASE + 400, fimMs: BASE + 600 }],
    });
  });

  it("e deterministica e nao muta os segmentos de entrada", () => {
    const antes = JSON.stringify(segmentos);
    const executar = () => vincularEventoASegmentos(iso(BASE + 900), iso(BASE + 1_100), segmentos);
    expect(executar()).toEqual(executar());
    expect(JSON.stringify(segmentos)).toBe(antes);
  });
});

describe("vinculo de descricoes e fatos visuais pontuais", () => {
  it("abre contexto fixo ao redor do instante, recortado pela cobertura real", () => {
    const refs = vincularInstanteAosSegmentos(BASE + 500, segmentos);
    expect(refs.map((ref) => ref.segmentoId)).toEqual(["seg-1"]);
    expect(refs[0]).toMatchObject({ offsetMs: 0, ateMs: 1_000, duracaoTrechoMs: 1_000 });
  });

  it("usa os limites de contexto injetados sem relogio", () => {
    const refs = vincularInstanteAosSegmentos(BASE + 500, segmentos, 100, 100);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ offsetMs: 400, ateMs: 600, duracaoTrechoMs: 200 });
    expect(JANELA_EVIDENCIA_ANTES_MS).toBe(2_000);
    expect(JANELA_EVIDENCIA_DEPOIS_MS).toBe(5_000);
  });

  it("nao devolve video para instante em lacuna nem para instante invalido", () => {
    expect(vincularInstanteAosSegmentos(BASE + 2_500, segmentos, 100, 100)).toEqual([]);
    expect(vincularInstanteAosSegmentos(Number.NaN, segmentos)).toEqual([]);
  });
});
