import { afterEach, describe, expect, it, vi } from "vitest";
import {
  descreverFrame,
} from "../../public/api";
import { json, ndjson, sinal } from "../helpers/api-respostas";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("descreverFrame", () => {
  it("consome o stream NDJSON e devolve o evento done", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        ndjson(
          { type: "chunk", response: "Uma pessoa " },
          { type: "chunk", response: "no escritorio." },
          {
            type: "done",
            descricao: "Uma pessoa no escritorio.",
            modelo: "qwen2.5vl:3b",
            tokens: 10,
            ms: 2000,
          }
        )
      )
    );

    const parciais: string[] = [];
    const resultado = await descreverFrame({ imagem: "x" }, sinal(), (p) => parciais.push(p));

    expect(resultado.parcial).toBe("Uma pessoa no escritorio.");
    expect(resultado.evento).toMatchObject({ descricao: "Uma pessoa no escritorio.", modelo: "qwen2.5vl:3b" });
    expect(parciais.at(-1)).toBe("Uma pessoa no escritorio.");
  });

  it("propaga o erro reportado no stream sem reembrulhar", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ndjson({ type: "erro", erro: "model not loaded" })));

    await expect(descreverFrame({ imagem: "x" }, sinal())).rejects.toThrow("model not loaded");
  });

  it("usa a mensagem do servidor quando a resposta nao e ok", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ erro: "Backend: falhou" }, 502)));

    await expect(descreverFrame({ imagem: "x" }, sinal())).rejects.toThrow("Backend: falhou");
  });

  it("sinaliza falha de rede", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );

    await expect(descreverFrame({ imagem: "x" }, sinal())).rejects.toThrow(
      "Falha ao contactar o servidor (/api/visao)"
    );
  });

  it("repassa o AbortError", async () => {
    const abortError = Object.assign(new Error("abortado"), { name: "AbortError" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw abortError;
      })
    );

    await expect(descreverFrame({ imagem: "x" }, sinal())).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});
