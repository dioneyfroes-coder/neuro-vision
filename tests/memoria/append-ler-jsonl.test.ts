import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { appendJsonl, lerUltimosJsonl, limparJsonl } from "../../src/memoria";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "neuro-memoria-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("appendJsonl / lerUltimosJsonl", () => {
  it("grava e le os ultimos registros (mais recente primeiro)", async () => {
    const arquivo = path.join(tmpDir, "dados.jsonl");
    await appendJsonl({ n: 1 }, arquivo, 1_000_000);
    await appendJsonl({ n: 2 }, arquivo, 1_000_000);
    await appendJsonl({ n: 3 }, arquivo, 1_000_000);

    const ultimos = await lerUltimosJsonl<{ n: number }>(arquivo, 10);
    expect(ultimos.map((r) => r.n)).toEqual([3, 2, 1]);

    const soDois = await lerUltimosJsonl<{ n: number }>(arquivo, 2);
    expect(soDois.map((r) => r.n)).toEqual([3, 2]);
  });

  it("retorna lista vazia para arquivo inexistente ou limite zero", async () => {
    const arquivo = path.join(tmpDir, "nao-existe.jsonl");
    expect(await lerUltimosJsonl(arquivo, 10)).toEqual([]);

    const outro = path.join(tmpDir, "dados.jsonl");
    await appendJsonl({ n: 1 }, outro, 1_000_000);
    expect(await lerUltimosJsonl(outro, 0)).toEqual([]);
  });

  it("ignora linhas corrompidas", async () => {
    const arquivo = path.join(tmpDir, "misto.jsonl");
    await appendJsonl({ n: 1 }, arquivo, 1_000_000);
    await appendJsonl("linha solta", arquivo, 1_000_000); // JSON valido, mas nao objeto
    await appendJsonl({ n: 2 }, arquivo, 1_000_000);
    const lido = await lerUltimosJsonl<{ n: number }>(arquivo, 10, (v): v is { n: number } => {
      return typeof v === "object" && v !== null && "n" in v;
    });
    expect(lido.map((r) => r.n)).toEqual([2, 1]);
  });

  it("rotaciona o arquivo quando passa do limite de bytes", async () => {
    const arquivo = path.join(tmpDir, "grande.jsonl");
    const registro = { texto: "x".repeat(100) };
    await appendJsonl(registro, arquivo, 50);
    await appendJsonl(registro, arquivo, 50);
    expect(await readFile(`${arquivo}.1`, "utf8")).toContain("x");
  });

  it("limparJsonl zera o arquivo e remove a rotacao", async () => {
    const arquivo = path.join(tmpDir, "dados.jsonl");
    await appendJsonl({ n: 1 }, arquivo, 1_000_000);
    await appendJsonl({ n: 2 }, arquivo, 1_000_000);
    await limparJsonl(arquivo);
    expect(await readFile(arquivo, "utf8")).toBe("");
    await expect(readFile(`${arquivo}.1`)).rejects.toThrow();
  });
});
