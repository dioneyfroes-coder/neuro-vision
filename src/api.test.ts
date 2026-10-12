import { afterEach, describe, expect, it, vi } from "vitest";
import {
  descreverFrame,
  gravarEvento,
  gravarOperacional,
  listarEntradas,
  listarEventos,
  limparHistorico,
  obterContexto,
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

describe("api de eventos e operacional", () => {
  it("gravarEvento envia o evento como JSON para /api/eventos", async () => {
    const fetchMock = vi.fn(
      async (_entrada: RequestInfo | URL, _init?: RequestInit) => json({ ok: true })
    );
    vi.stubGlobal("fetch", fetchMock);

    await gravarEvento({
      id: "e1",
      timestamp: "t",
      tipo: "aparicao",
      descricao: "apareceu pessoa",
      origem: "rastreador",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/eventos",
      expect.objectContaining({ method: "POST" })
    );
    const init = fetchMock.mock.calls[0]?.[1];
    const corpo = JSON.parse((init?.body as string) ?? "{}") as { tipo: string };
    expect(corpo.tipo).toBe("aparicao");
  });

  it("gravarEvento sinaliza falha de rede", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );

    await expect(
      gravarEvento({ id: "e1", timestamp: "t", tipo: "movimento", descricao: "x", origem: "rastreador" })
    ).rejects.toThrow("Falha ao gravar evento no servidor");
  });

  it("listarEventos devolve os eventos do servidor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ eventos: [{ id: "e1" }, { id: "e2" }] }))
    );

    expect(await listarEventos(5)).toEqual([{ id: "e1" }, { id: "e2" }]);
  });

  it("listarEventos monta a query com tipos, objeto e janela", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL) => json({ eventos: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await listarEventos(10, {
      tipos: ["aparicao", "desaparecimento"],
      objetoId: "obj-1",
      desde: 1000,
      ate: 2000,
    });

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("/api/eventos?");
    const params = new URLSearchParams(url.slice(url.indexOf("?") + 1));
    expect(params.get("limit")).toBe("10");
    expect(params.get("tipo")).toBe("aparicao,desaparecimento");
    expect(params.get("objetoId")).toBe("obj-1");
    expect(params.get("desde")).toBe("1000");
    expect(params.get("ate")).toBe("2000");
  });

  it("listarEventos sem filtros envia apenas o limite", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL) => json({ eventos: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await listarEventos(7);

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/api/eventos?limit=7");
  });

  it("gravarOperacional e best-effort e nao lanca em falha de rede", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );

    await expect(gravarOperacional({ nivel: "erro", mensagem: "falha" })).resolves.toBeUndefined();
  });

  it("obterContexto normaliza o contexto recuperado", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          ok: true,
          resumo: "Descricoes recentes: x",
          roteiro: ["passo 1"],
          ultimaDescricao: "pessoa na sala",
          entradas: [{ resumo: "pessoa na sala" }],
          eventos: [{ id: "e1" }],
        })
      )
    );

    const contexto = await obterContexto();
    expect(contexto).toMatchObject({
      resumo: "Descricoes recentes: x",
      roteiro: ["passo 1"],
      ultimaDescricao: "pessoa na sala",
    });
    expect(contexto?.entradas).toHaveLength(1);
    expect(contexto?.eventos).toHaveLength(1);
  });

  it("obterContexto sinaliza falha de rede", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );

    await expect(obterContexto()).rejects.toThrow("Falha ao recuperar o contexto");
  });
});
