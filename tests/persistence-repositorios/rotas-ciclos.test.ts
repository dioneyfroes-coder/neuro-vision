import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { criarRegistroCiclo } from "../../src/domain/cycle";
import { lerCiclos } from "../../src/persistence/repositorio-ciclos";
import { comServidor, observacao, resultadoCiclo } from "../helpers/persistence-repositorios";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "neuro-persistencia-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("rotas de ciclos", () => {
it("grava, lista e limpa o diagnostico de um ciclo", async () => {
  const logFile = path.join(tmpDir, "visao.jsonl");
  const ciclosFile = path.join(tmpDir, "ciclos.jsonl");
  const registro = criarRegistroCiclo(resultadoCiclo([observacao("f1")]));
  const politica = {
    id: "benchmark-1s",
    finalidade: "benchmark" as const,
    referencia: "1s",
    intervaloEntreSnapshotsMs: 1000,
    quantidadeSnapshots: 4,
    janelaNominalMs: 3000,
    pausaAposCicloMs: 6000,
    interpretacao: "a_cada_ciclo" as const,
  };
  registro.politica = politica;
  registro.configuracao = {
    varianteId: "completa",
    quantidadeSnapshotsConfigurada: 4,
    intervaloEntreSnapshotsMs: 1000,
    intervaloAgendamentoMs: 5000,
    modeloMultimodalEfetivo: "vision-model",
    interpretador: {
      modeloSolicitado: "vision-model",
      incluirDadosLocais: true,
      limites: {
        maxImagens: 4,
        maxEventos: 20,
        maxPontosPorFrame: 6,
        decimais: 2,
        maxBytesContexto: 16_000,
      },
      serializacao: {
        decimais: 2,
        landmarksCompletos: false,
        geometriaMao: true,
        confiancaMinimaKeypoint: 0.3,
        maxKeypointsPorPessoa: 17,
        confiancaMinimaDeteccao: 0,
        maxDeteccoesPorFrame: 20,
        maxPessoasPorFrame: 8,
        maxMaosPorFrame: 8,
      },
    },
  };

  await comServidor({ logFile, ciclosFile, publicDir: tmpDir }, async (base) => {
    const post = await fetch(`${base}/api/ciclos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(registro),
    });
    expect(post.status).toBe(200);

    const list = await fetch(`${base}/api/ciclos`);
    const corpo = (await list.json()) as { ok: boolean; total: number; ciclos: unknown[] };
    expect(corpo).toMatchObject({ ok: true, total: 1 });
    expect(corpo.ciclos[0]).toMatchObject({
      cycleId: "sessao-1-c1",
      frameIds: ["f1"],
      politica,
      configuracao: registro.configuracao,
    });

    const del = await fetch(`${base}/api/ciclos`, { method: "DELETE" });
    expect(del.status).toBe(200);
    expect(await readFile(ciclosFile, "utf8")).toBe("");
  });
});

it("rejeita ciclo sem sessionId/cycleId", async () => {
  const logFile = path.join(tmpDir, "visao.jsonl");
  await comServidor({ logFile, publicDir: tmpDir }, async (base) => {
    const res = await fetch(`${base}/api/ciclos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ frameIds: [] }),
    });
    expect(res.status).toBe(400);
  });
});

it("limpar historico (DELETE /api/logs) tambem apaga os ciclos", async () => {
  const logFile = path.join(tmpDir, "visao.jsonl");
  const ciclosFile = path.join(tmpDir, "ciclos.jsonl");
  const registro = criarRegistroCiclo(resultadoCiclo([observacao("f1")]));

  await comServidor({ logFile, ciclosFile, publicDir: tmpDir }, async (base) => {
    await fetch(`${base}/api/ciclos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(registro),
    });
    expect(await lerCiclos(ciclosFile, 10)).toHaveLength(1);

    const res = await fetch(`${base}/api/logs`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await lerCiclos(ciclosFile, 10)).toEqual([]);
  });
});
});
