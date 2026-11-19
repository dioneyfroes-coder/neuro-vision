import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  descobrirClipes,
  gravarRelatorioSeguro,
  resolverSidecarInicioEventos,
  VARIANTES_BENCHMARK,
} from "../../../scripts/benchmark-variantes.mjs";

// ---------------------------------------------------------------------------
// Gravacao segura (bench/BASELINE.md e imutavel)
// ---------------------------------------------------------------------------

describe("gravarRelatorioSeguro", () => {
  let dir;
  afterAll(() => dir && rm(dir, { recursive: true, force: true }));

  it("recusa qualquer caminho que resolva para BASELINE.md", async () => {
    await expect(gravarRelatorioSeguro("bench", "BASELINE.md", "x")).rejects.toThrow(/imutavel/i);
    await expect(gravarRelatorioSeguro("bench", "baseline.md", "x")).rejects.toThrow(/imutavel/i);
    await expect(gravarRelatorioSeguro("bench", "../bench/BASELINE.md", "x")).rejects.toThrow(/imutavel/i);
  });

  it("recusa nomes fora do padrao RELATORIO_VARIANTE_*/COMPARATIVO_*", async () => {
    await expect(gravarRelatorioSeguro("bench", "qualquer-coisa.md", "x")).rejects.toThrow(/padrao/i);
    await expect(gravarRelatorioSeguro("bench", "RELATORIO_VARIANTE_E_20260101.md", "x")).rejects.toThrow(/padrao/i);
  });

  it("grava relatorios e comparativos no padrao", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "neuro-bench-"));
    const rel = await gravarRelatorioSeguro(dir, "RELATORIO_VARIANTE_D_20260101.md", "# D");
    const cmp = await gravarRelatorioSeguro(dir, "COMPARATIVO_A_B_C_D_20260101.md", "# CMP");
    expect(rel.endsWith("RELATORIO_VARIANTE_D_20260101.md")).toBe(true);
    expect(cmp.endsWith("COMPARATIVO_A_B_C_D_20260101.md")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Matriz de variantes (espelha public/perception/variantes.ts)
// ---------------------------------------------------------------------------

describe("VARIANTES_BENCHMARK", () => {
  it("mantem a matriz A/B/C/D coerente com o roteiro", () => {
    expect(VARIANTES_BENCHMARK.map((v) => v.letra)).toEqual(["A", "B", "C", "D"]);
    const por = Object.fromEntries(VARIANTES_BENCHMARK.map((v) => [v.letra, v]));
    expect(por.A).toMatchObject({ imagens: 1, dadosLocais: false, temporal: "ausente" });
    expect(por.B).toMatchObject({ imagens: 4, dadosLocais: false, temporal: "ausente" });
    expect(por.C).toMatchObject({ imagens: 4, dadosLocais: true, temporal: "basico" });
    expect(por.D).toMatchObject({ imagens: 4, dadosLocais: true, temporal: "ampliado" });
    for (const v of VARIANTES_BENCHMARK) {
      if (v.dadosLocais) expect(v.percepcaoLocal).toBe(true);
    }
  });
});

describe("descobrirClipes", () => {
  it("limita EVAL as anotacoes oficiais e nao herda sidecar de tuning", async () => {
    const raiz = await mkdtemp(path.join(tmpdir(), "neuro-eval-clipes-"));
    const videos = path.join(raiz, "videos");
    const evalDir = path.join(raiz, "eval");
    try {
      await Promise.all([
        mkdir(videos, { recursive: true }),
        mkdir(evalDir, { recursive: true }),
      ]);
      await Promise.all([
        writeFile(path.join(videos, "eval-clip.mp4"), "eval"),
        writeFile(path.join(videos, "tuning-clip.mp4"), "tuning"),
        writeFile(path.join(videos, "tuning-clip.json"), JSON.stringify({ clip: "tuning-clip.mp4" })),
        writeFile(path.join(evalDir, "manifest.json"), "{}"),
        writeFile(path.join(evalDir, "eval-clip.json"), JSON.stringify({ clip: "eval-clip.mp4" })),
      ]);

      const clipes = await descobrirClipes(videos, [], evalDir, true);
      expect(clipes.map(({ nome, anotacao }) => ({ nome, anotacao }))).toEqual([
        { nome: "eval-clip.mp4", anotacao: path.relative(process.cwd(), path.join(evalDir, "eval-clip.json")) },
      ]);
    } finally {
      await rm(raiz, { recursive: true, force: true });
    }
  });
});

describe("resolverSidecarInicioEventos", () => {
  it("aceita o formato canonico e o formato legado dos sidecars", async () => {
    const raiz = await mkdtemp(path.join(tmpdir(), "neuro-sidecar-"));
    try {
      const eventos = path.join(raiz, "eventos.jsonl");
      const canonico = `${eventos}.inicio`;
      await writeFile(canonico, "2026-10-11T14:49:51.315Z\n");
      expect(await resolverSidecarInicioEventos(eventos)).toBe(canonico);

      await rm(canonico);
      const legado = eventos.replace(/\.jsonl$/i, ".inicio");
      await writeFile(legado, "2026-10-11T14:49:51.315Z\n");
      expect(await resolverSidecarInicioEventos(eventos)).toBe(legado);
    } finally {
      await rm(raiz, { recursive: true, force: true });
    }
  });
});

describe("gate do conjunto EVAL", () => {
  it("recusa avaliar tuning como conjunto reservado", () => {
    const resultado = spawnSync(
      process.execPath,
      [
        "scripts/benchmark-variantes.mjs",
        "--conjunto",
        "eval",
        "--anotacoes-dir",
        "bench/clipes/tuning",
      ],
      { encoding: "utf8" }
    );
    expect(resultado.status).toBe(1);
    expect(resultado.stderr).toContain("eval exige o conjunto completo");
  });
});