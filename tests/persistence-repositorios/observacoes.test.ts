import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gravarObservacao, lerObservacoes, limparObservacoes } from "../../src/persistence/repositorio-observacoes";
import { entrada } from "../helpers/persistence-repositorios";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "neuro-persistencia-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("repositorio de observacoes", () => {
  it("grava, le as mais recentes primeiro e limpa", async () => {
    const arquivo = path.join(tmpDir, "visao.jsonl");
    await gravarObservacao(entrada("a"), arquivo, 1_000_000);
    await gravarObservacao(entrada("b"), arquivo, 1_000_000);

    const lidas = await lerObservacoes(arquivo, 10);
    expect(lidas.map((e) => e.resumo)).toEqual(["b", "a"]);

    await limparObservacoes(arquivo);
    expect(await readFile(arquivo, "utf8")).toBe("");
  });
});
