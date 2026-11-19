import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  gravarSegmentoMonitoramento,
  gravarSessaoMonitoramento,
  lerSegmentosDaSessao,
  lerSegmentosMonitoramento,
  lerSessoesMonitoramento,
} from "../../src/persistence/repositorio-monitoramento";
import { BASE, MAX_BYTES, segmento, sessao } from "../helpers/monitoramento-persistencia";

let tmpDir: string;
let sessoesFile: string;
let segmentosFile: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "neuro-monitoramento-"));
  sessoesFile = path.join(tmpDir, "monitoramento-sessoes.jsonl");
  segmentosFile = path.join(tmpDir, "monitoramento-segmentos.jsonl");
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("repositorio de monitoramento", () => {
  it("mantem apenas a versao mais recente de cada sessao", async () => {
    await gravarSessaoMonitoramento(sessao(), sessoesFile, MAX_BYTES);
    await gravarSessaoMonitoramento(
      sessao({ estado: "encerrada", encerradaEmMs: BASE + 5000 }),
      sessoesFile,
      MAX_BYTES
    );

    const sessoes = await lerSessoesMonitoramento(sessoesFile, 100);
    expect(sessoes).toHaveLength(1);
    expect(sessoes[0]).toMatchObject({ sessaoId: "sessao-1", estado: "encerrada" });
  });

  it("mantem apenas a versao mais recente de cada segmento, em ordem cronologica", async () => {
    await gravarSegmentoMonitoramento(segmento("seg-2", 2), segmentosFile, MAX_BYTES);
    await gravarSegmentoMonitoramento(segmento("seg-1", 1), segmentosFile, MAX_BYTES);
    await gravarSegmentoMonitoramento(
      segmento("seg-2", 2, { estado: "incompleto", motivoFim: "lacuna", quadros: 4 }),
      segmentosFile,
      MAX_BYTES
    );

    const segmentos = await lerSegmentosMonitoramento(segmentosFile, 100);
    expect(segmentos.map((s) => s.segmentoId)).toEqual(["seg-1", "seg-2"]);
    expect(segmentos[1]).toMatchObject({
      estado: "incompleto",
      motivoFim: "lacuna",
      quadros: 4,
    });
  });

  it("filtra segmentos por sessao sem confundir indices de outra sessao", async () => {
    await gravarSegmentoMonitoramento(segmento("seg-1", 1), segmentosFile, MAX_BYTES);
    await gravarSegmentoMonitoramento(
      segmento("seg-outra", 1, { sessaoId: "sessao-2" }),
      segmentosFile,
      MAX_BYTES
    );

    const daSessao = await lerSegmentosDaSessao(segmentosFile, "sessao-1", 100);
    expect(daSessao.map((s) => s.segmentoId)).toEqual(["seg-1"]);
  });
});
