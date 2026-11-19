import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gravarOperacional, lerOperacional } from "../../src/persistence/repositorio-operacional";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "neuro-persistencia-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("repositorio operacional", () => {
  it("grava e le registros operacionais", async () => {
    const arquivo = path.join(tmpDir, "operacional.jsonl");
    await gravarOperacional(
      { timestamp: "x", nivel: "erro", origem: "cliente", mensagem: "falhou" },
      arquivo,
      1_000_000
    );
    const lidos = await lerOperacional(arquivo, 10);
    expect(lidos).toHaveLength(1);
    expect(lidos[0]).toMatchObject({ nivel: "erro", mensagem: "falhou" });
  });
});
