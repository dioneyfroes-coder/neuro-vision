import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LOG_DIR, LOG_FILE, PUBLIC_DIR, ROOT, localizarRaiz } from "../src/http/base";

const raizRepositorio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("caminhos padrao do servidor", () => {
  it("continua apontando para a raiz do repositorio apos a extracao dos modulos HTTP", () => {
    expect(ROOT).toBe(raizRepositorio);
    expect(PUBLIC_DIR).toBe(path.join(raizRepositorio, "public"));
    expect(LOG_DIR).toBe(path.join(raizRepositorio, "logs"));
    expect(LOG_FILE).toBe(path.join(raizRepositorio, "logs", "visao.jsonl"));
  });

  it("resolve a raiz tanto em src/http (tsx) quanto em dist (bundle)", () => {
    expect(localizarRaiz(path.join(raizRepositorio, "src", "http"))).toBe(raizRepositorio);
    expect(localizarRaiz(path.join(raizRepositorio, "dist"))).toBe(raizRepositorio);
  });
});
