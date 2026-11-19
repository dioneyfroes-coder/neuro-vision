import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eventoJaRegistrado, gravarEvento, lerEventos, limparEventos, marcarEventoRegistrado } from "../../src/persistence/repositorio-eventos";
import { evento } from "../helpers/persistence-repositorios";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "neuro-persistencia-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("repositorio de eventos", () => {
  it("grava, le e controla a idempotencia por arquivo", async () => {
    const arquivo = path.join(tmpDir, "eventos.jsonl");
    await gravarEvento(evento("subiu"), arquivo, 1_000_000);
    expect((await lerEventos(arquivo, 10)).map((e) => e.descricao)).toEqual(["subiu"]);

    expect(eventoJaRegistrado(arquivo, "chave-1")).toBe(false);
    marcarEventoRegistrado(arquivo, "chave-1");
    expect(eventoJaRegistrado(arquivo, "chave-1")).toBe(true);

    // Limpar o arquivo invalida as chaves antigas.
    await limparEventos(arquivo);
    expect(eventoJaRegistrado(arquivo, "chave-1")).toBe(false);
  });
});
