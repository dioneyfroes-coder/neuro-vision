import { describe, expect, it } from "vitest";
import { filtrarEventos } from "../../src/memoria";
import type { EventoVisual } from "../../src/types";

describe("filtrarEventos", () => {
  const eventos: EventoVisual[] = [
    {
      id: "e1",
      timestamp: "2026-10-11T10:00:00.000Z",
      tipo: "aparicao",
      objetoId: "obj-1",
      descricao: "apareceu pessoa",
      confianca: 0.9,
      origem: "rastreador",
    },
    {
      id: "e2",
      timestamp: "2026-10-11T10:01:00.000Z",
      tipo: "movimento",
      objetoId: "obj-2",
      descricao: "movimento de gato",
      confianca: 0.5,
      origem: "rastreador",
    },
    {
      id: "e3",
      timestamp: "2026-10-11T10:02:00.000Z",
      tipo: "desaparecimento",
      objetoId: "obj-1",
      descricao: "desapareceu pessoa",
      origem: "rastreador",
    },
  ];

  it("sem filtros devolve tudo", () => {
    expect(filtrarEventos(eventos)).toHaveLength(3);
  });

  it("filtra por tipo (o que mudou)", () => {
    expect(filtrarEventos(eventos, { tipos: ["movimento"] }).map((e) => e.id)).toEqual(["e2"]);
    expect(
      filtrarEventos(eventos, { tipos: ["aparicao", "desaparecimento"] }).map((e) => e.id)
    ).toEqual(["e1", "e3"]);
  });

  it("filtra por objeto", () => {
    expect(filtrarEventos(eventos, { objetoId: "obj-1" }).map((e) => e.id)).toEqual(["e1", "e3"]);
  });

  it("filtra por janela temporal (quando) com bordas inclusivas", () => {
    const desdeMs = Date.parse("2026-10-11T10:01:00.000Z");
    const ateMs = Date.parse("2026-10-11T10:02:00.000Z");
    expect(filtrarEventos(eventos, { desdeMs, ateMs }).map((e) => e.id)).toEqual(["e2", "e3"]);
    expect(filtrarEventos(eventos, { desdeMs }).map((e) => e.id)).toEqual(["e2", "e3"]);
    expect(filtrarEventos(eventos, { ateMs: Date.parse("2026-10-11T10:00:00.000Z") }).map((e) => e.id)).toEqual(["e1"]);
  });

  it("combina tipo, objeto e janela", () => {
    const filtrados = filtrarEventos(eventos, {
      tipos: ["aparicao", "desaparecimento"],
      objetoId: "obj-1",
      desdeMs: Date.parse("2026-10-11T10:01:30.000Z"),
    });
    expect(filtrados.map((e) => e.id)).toEqual(["e3"]);
  });

  it("mantem eventos com timestamp invalido quando nao ha filtro temporal", () => {
    const semData: EventoVisual[] = [
      { id: "x", timestamp: "sem-data", tipo: "resumo", descricao: "r", origem: "visao" },
    ];
    expect(filtrarEventos(semData, { tipos: ["resumo"] })).toHaveLength(1);
  });
});
