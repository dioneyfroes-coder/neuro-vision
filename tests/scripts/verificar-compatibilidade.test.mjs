import { describe, expect, it } from "vitest";
import {
  verificarCompatibilidade,
  verificarNoDisco,
} from "../../scripts/verificar-compatibilidade.mjs";

function textos() {
  return {
    clienteOffline: [
      'export const VERSAO_MEDIAPIPE = "0.10.21";',
      'export const VERSAO_TRANSFORMERS = "3.8.1";',
      'export const VERSAO_ONNXRUNTIME = "1.21.0";',
    ].join("\n"),
    manifestoOffline: [
      "export const VERSOES = {",
      '  mediapipe: "0.10.21",',
      '  transformers: "3.8.1",',
      '  onnxruntime: "1.21.0",',
      "};",
    ].join("\n"),
    gestos: 'from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21"',
    pose: 'from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1"',
    declaracoesMediapipe: 'declare module "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21"',
    declaracoesTransformers: 'declare module "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1"',
    vitestConfig: '"https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1": fileURLToPath(',
    packageJson: JSON.stringify({
      engines: { node: "^22.12.0 || ^24.0.0 || >=26.0.0" },
      devDependencies: { "onnxruntime-web": "^1.21.0" },
    }),
    nvmrc: "22.12.0",
    nodeVersion: "22.12.0",
  };
}

describe("politica de compatibilidade", () => {
  it("aceita um conjunto sincronizado", () => {
    const resultado = verificarCompatibilidade(textos());
    expect(resultado.ok).toBe(true);
    expect(resultado.problemas).toEqual([]);
    expect(resultado.versoes).toEqual({
      mediapipe: "0.10.21",
      transformers: "3.8.1",
      onnxruntime: "1.21.0",
    });
  });

  it("detecta divergencia no manifesto offline", () => {
    const entrada = textos();
    entrada.manifestoOffline = entrada.manifestoOffline.replace("3.8.1", "3.9.0");
    const resultado = verificarCompatibilidade(entrada);
    expect(resultado.ok).toBe(false);
    expect(resultado.problemas.join(" ")).toContain("3.9.0 difere de 3.8.1");
  });

  it("detecta divergencia na URL de import do CDN", () => {
    const entrada = textos();
    entrada.pose = entrada.pose.replace("3.8.1", "3.9.0");
    const resultado = verificarCompatibilidade(entrada);
    expect(resultado.ok).toBe(false);
    expect(resultado.problemas.join(" ")).toContain("public/pose.ts");
  });

  it("nao inventa versao quando a declaracao esta ausente", () => {
    const entrada = textos();
    entrada.gestos = "import tipo qualquer";
    const resultado = verificarCompatibilidade(entrada);
    expect(resultado.ok).toBe(false);
    expect(resultado.problemas.join(" ")).toContain("public/gestos.ts: versao nao declarada");
  });

  it("detecta Node fora da faixa declarada em engines", () => {
    const entrada = textos();
    entrada.nvmrc = "20.0.0";
    entrada.nodeVersion = "20.0.0";
    const resultado = verificarCompatibilidade(entrada);
    expect(resultado.ok).toBe(false);
    expect(resultado.problemas.join(" ")).toContain("nao esta coberto por engines.node");
  });

  it("detecta .nvmrc e .node-version divergentes", () => {
    const entrada = textos();
    entrada.nodeVersion = "24.0.0";
    const resultado = verificarCompatibilidade(entrada);
    expect(resultado.ok).toBe(false);
    expect(resultado.problemas.join(" ")).toContain("difere de .node-version");
  });

  it("valida os arquivos reais do repositorio", async () => {
    const resultado = await verificarNoDisco();
    expect(resultado.problemas).toEqual([]);
    expect(resultado.ok).toBe(true);
  });
});
