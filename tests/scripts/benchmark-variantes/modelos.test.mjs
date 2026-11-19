import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  extrairModelosDoJsonl,
  modelosDosFrames,
  verificarMesmoModelo,
} from "../../../scripts/benchmark-variantes.mjs";

// ---------------------------------------------------------------------------
// Garantia de mesmo modelo multimodal
// ---------------------------------------------------------------------------

describe("extrairModelosDoJsonl / modelosDosFrames", () => {
  let dir;
  afterAll(() => dir && rm(dir, { recursive: true, force: true }));

  it("extrai modelos distintos de um JSONL e ignora linhas corrompidas", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "neuro-bench-"));
    const arquivo = path.join(dir, "eventos.jsonl");
    await writeFile(
      arquivo,
      [
        JSON.stringify({ modelo: "qwen2.5-vl-3b-instruct" }),
        JSON.stringify({ modelo: "qwen2.5-vl-3b-instruct" }),
        JSON.stringify({ modelo: "gemma-3n-e4b" }),
        JSON.stringify({ semModelo: true }),
        "linha corrompida {",
        "",
      ].join("\n"),
      "utf8"
    );
    expect(await extrairModelosDoJsonl(arquivo)).toEqual(["gemma-3n-e4b", "qwen2.5-vl-3b-instruct"]);
  });

  it("resolve o modelo pelos frameIds dos ciclos em visao.jsonl", async () => {
    dir ??= await mkdtemp(path.join(tmpdir(), "neuro-bench-"));
    const visao = path.join(dir, "visao.jsonl");
    await writeFile(
      visao,
      [
        JSON.stringify({ frameId: "f-b1", modelo: "qwen2.5-vl-3b-instruct" }),
        JSON.stringify({ frameId: "f-b2", modelo: "qwen2.5-vl-3b-instruct" }),
        JSON.stringify({ frameId: "f-d1", modelo: "gemma-3n-e4b" }),
        JSON.stringify({ frameIds: ["f-a1", "f-a2"], modelo: "qwen2.5-vl-3b-instruct" }),
        JSON.stringify({ frameId: "f-sem-modelo" }),
        "lixo {",
      ].join("\n"),
      "utf8"
    );
    expect(await modelosDosFrames(visao, ["f-b1", "f-b2"])).toEqual(["qwen2.5-vl-3b-instruct"]);
    expect(await modelosDosFrames(visao, ["f-d1"])).toEqual(["gemma-3n-e4b"]);
    expect(await modelosDosFrames(visao, ["f-a2"])).toEqual(["qwen2.5-vl-3b-instruct"]);
    expect(await modelosDosFrames(visao, ["f-inexistente"])).toEqual([]);
    expect(await modelosDosFrames(visao, [])).toEqual([]);
    expect(await modelosDosFrames(path.join(dir, "nao-existe.jsonl"), ["f-b1"])).toEqual([]);
  });
});

describe("verificarMesmoModelo", () => {
  const resultado = (letra, visao, deteccao = []) => ({
    variante: { letra },
    modelos: { visao, deteccao },
  });

  it("confirma quando todas as variantes usaram o mesmo modelo", () => {
    const r = verificarMesmoModelo(
      [resultado("B", ["qwen2.5-vl-3b-instruct"]), resultado("D", ["qwen2.5-vl-3b-instruct"])],
      "qwen2.5-vl-3b-instruct"
    );
    expect(r.consistente).toBe(true);
    expect(r.modelos).toEqual(["qwen2.5-vl-3b-instruct"]);
    expect(r.avisos).toEqual([]);
  });

  it("ignora o modelo do detector local nos eventos", () => {
    const r = verificarMesmoModelo(
      [
        resultado("B", ["qwen2.5-vl-3b-instruct"], ["Xenova/yolos-tiny"]),
        resultado("D", ["qwen2.5-vl-3b-instruct"], ["outro-detector"]),
      ],
      "qwen2.5-vl-3b-instruct"
    );
    expect(r.consistente).toBe(true);
    expect(r.modelos).toEqual(["qwen2.5-vl-3b-instruct"]);
  });

  it("alerta quando as variantes divergem", () => {
    const r = verificarMesmoModelo([
      resultado("B", ["qwen2.5-vl-3b-instruct"]),
      resultado("D", ["gemma-3n-e4b"]),
    ]);
    expect(r.consistente).toBe(false);
    expect(r.avisos.some((a) => a.includes("divergentes"))).toBe(true);
  });

  it("alerta quando uma variante difere do --modelo registrado", () => {
    const r = verificarMesmoModelo(
      [resultado("B", ["qwen2.5-vl-3b-instruct"]), resultado("C", ["gemma-3n-e4b"])],
      "qwen2.5-vl-3b-instruct"
    );
    expect(r.consistente).toBe(false);
    expect(r.avisos.some((a) => a.includes("variante C"))).toBe(true);
  });

  it("alerta quando nao ha dados para verificar", () => {
    const r = verificarMesmoModelo([resultado("A", [], [])], "");
    expect(r.consistente).toBe(false);
    expect(r.avisos.some((a) => a.includes("nao foi possivel verificar"))).toBe(true);
  });
});