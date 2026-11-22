import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  lerInicioSidecarEventos,
  parsearEventos,
  resolverBaseMs,
} from "../../../scripts/avaliar-qualidade.mjs";

describe("resolverBaseMs", () => {
  it("prefere o sidecar ao inicio da anotacao", () => {
    const base = resolverBaseMs({
      inicioSidecar: "2026-10-11T14:49:51.315Z",
      inicio: "2026-10-11T00:00:00.000Z",
    });
    expect(base).toBe(Date.parse("2026-10-11T14:49:51.315Z"));
  });

  it("usa o inicio da anotacao quando nao ha sidecar", () => {
    const base = resolverBaseMs({ inicio: "2026-10-11T12:00:00.000Z" });
    expect(base).toBe(Date.parse("2026-10-11T12:00:00.000Z"));
  });

  it("usa o timestamp mais antigo quando nao ha inicio", () => {
    const base = resolverBaseMs({
      timestamps: ["2026-10-11T12:00:07.000Z", "2026-10-11T12:00:03.000Z"],
    });
    expect(base).toBe(Date.parse("2026-10-11T12:00:03.000Z"));
  });

  it("retorna 0 sem base e sem timestamps validos", () => {
    expect(resolverBaseMs({})).toBe(0);
    expect(resolverBaseMs({ timestamps: ["invalido"] })).toBe(0);
  });
});

describe("lerInicioSidecarEventos", () => {
  it("le os formatos canonico e legado do sidecar", async () => {
    const raiz = await mkdtemp(path.join(tmpdir(), "neuro-inicio-"));
    try {
      const eventos = path.join(raiz, "eventos.jsonl");
      const canonico = `${eventos}.inicio`;
      const inicioCanonico = "2026-10-11T14:49:51.315Z";
      await writeFile(canonico, `${inicioCanonico}\n`);
      expect(await lerInicioSidecarEventos(eventos)).toBe(inicioCanonico);

      await rm(canonico);
      const legado = eventos.replace(/\.jsonl$/i, ".inicio");
      const inicioLegado = "2026-10-11T14:50:00.000Z";
      await writeFile(legado, `${inicioLegado}\n`);
      expect(await lerInicioSidecarEventos(eventos)).toBe(inicioLegado);
    } finally {
      await rm(raiz, { recursive: true, force: true });
    }
  });
});

describe("parsearEventos", () => {
  it("le JSONL e ignora linhas corrompidas ou incompletas", () => {
    const texto = [
      JSON.stringify({
        timestamp: "2026-01-01T00:00:00.000Z",
        tipo: "aparicao",
        descricao: "x",
        rotuloObjeto: "person",
        origensSinal: ["objetos"],
      }),
      "linha corrompida",
      JSON.stringify({ tipo: "sem-timestamp" }),
      "",
      JSON.stringify({ timestamp: "2026-01-01T00:00:05.000Z", tipo: "movimento" }),
    ].join("\n");
    const r = parsearEventos(texto);
    expect(r).toHaveLength(2);
    expect(r[0].descricao).toBe("x");
    expect(r[0]).toMatchObject({ rotuloObjeto: "person", origensSinal: ["objetos"] });
    expect(r[1].tipo).toBe("movimento");
  });

  it("le eventos temporais pelo inicioEm, sem exigir timestamp legado", () => {
    const texto = JSON.stringify({
      eventoId: "e1",
      tipo: "interacao_objeto",
      inicioEm: "2026-11-22T10:00:01.000Z",
      estado: "confirmado",
      statusEvidencia: "inferido",
      naturezaInteracao: "manipulacao",
      transicaoPosse: "pego",
      rotuloObjeto: "garrafa",
      origens: ["maos", "objetos", "invalida"],
      descricao: "mao e garrafa",
      frameIds: ["f1", "f2"],
    });
    const r = parsearEventos(texto);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      tipo: "interacao_objeto",
      timestamp: "2026-11-22T10:00:01.000Z",
      inicioEm: "2026-11-22T10:00:01.000Z",
      naturezaInteracao: "manipulacao",
      transicaoPosse: "pego",
      statusEvidencia: "inferido",
      rotuloObjeto: "garrafa",
      origensSinal: ["maos", "objetos"],
    });
  });
});
