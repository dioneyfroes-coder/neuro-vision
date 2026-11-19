import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { criarRegistroCiclo } from "../../src/domain/cycle";
import { gravarCiclo, lerCiclos, limparCiclos } from "../../src/persistence/repositorio-ciclos";
import { observacao, resultadoCiclo } from "../helpers/persistence-repositorios";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "neuro-persistencia-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("repositorio de ciclos", () => {
  it("grava, le e limpa registros de ciclo", async () => {
    const arquivo = path.join(tmpDir, "ciclos.jsonl");
    const registro = criarRegistroCiclo(resultadoCiclo([observacao("f1")]));
    await gravarCiclo(registro, arquivo, 1_000_000);
    await gravarCiclo({ ...registro, cycleId: "sessao-1-c2" }, arquivo, 1_000_000);

    const lidos = await lerCiclos(arquivo, 10);
    expect(lidos.map((c) => c.cycleId)).toEqual(["sessao-1-c2", "sessao-1-c1"]);

    await limparCiclos(arquivo);
    expect(await lerCiclos(arquivo, 10)).toEqual([]);
  });
});
