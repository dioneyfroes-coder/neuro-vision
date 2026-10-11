import { afterEach, describe, expect, it, vi } from "vitest";
import {
  descreverFrame,
  listarEntradas,
  limparHistorico,
  prepararOllama,
  saudeOllama,
} from "../public/api";

afterEach(() => {
  vi.unstubAllGlobals();
});

function ndjson(...eventos: unknown[]): Response {
  return new Response(eventos.map((e) => JSON.stringify(e)).join("\n") + "\n");
}

function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sinal(): AbortSignal {
  return new AbortController().signal;
}

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
    vi.stubGlobal("fetch", vi.fn(async () => json({ erro: "Ollama: falhou" }, 502)));

    await expect(descreverFrame({ imagem: "x" }, sinal())).rejects.toThrow("Ollama: falhou");
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

describe("api de leitura", () => {
  it("listarEntradas devolve as entradas do servidor", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ entradas: [{ resumo: "a" }, { resumo: "b" }] })));

    expect(await listarEntradas(10)).toEqual([{ resumo: "a" }, { resumo: "b" }]);
  });

  it("listarEntradas lanca quando a resposta falha", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({}, 500)));

    await expect(listarEntradas()).rejects.toThrow("HTTP 500");
  });

  it("limparHistorico lanca quando a resposta falha", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({}, 500)));

    await expect(limparHistorico()).rejects.toThrow("HTTP 500");
  });

  it("saudeOllama devolve o objeto ollama", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ ollama: { online: true, modelos: ["m"], carregados: [], erro: "" } }))
    );

    const info = await saudeOllama();
    expect(info?.online).toBe(true);
    expect(info?.modelos).toEqual(["m"]);
  });

  it("prepararOllama usa a mensagem de erro do servidor", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ erro: "Ollama: modelo indisponivel" }, 502)));

    await expect(prepararOllama()).rejects.toThrow("Ollama: modelo indisponivel");
  });
});
