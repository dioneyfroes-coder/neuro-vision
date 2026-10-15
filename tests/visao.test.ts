import { afterEach, describe, expect, it, vi } from "vitest";
import {
  escolherModelo,
  extrairBase64,
  forcarCarregamento,
  gerarDescricao,
  gerarDescricaoStream,
  limparCacheModelo,
  melhorModeloDisponivel,
  mesmoModelo,
  memoriaIntrospectavel,
  modeloEmMemoria,
  modelosEmMemoria,
  modelosInstalados,
  montarPromptDescricao,
  montarPromptRoteiro,
  normalizarNomeModelo,
  NUM_PREDICT_BASE,
  NUM_PREDICT_DELTA,
  MODELO_PADRAO,
  PROMPT_DESCRICAO,
  PROMPT_ROTEIRO_BASE,
  PROMPT_ROTEIRO_DELTA,
} from "../src/visao";

afterEach(() => {
  vi.unstubAllGlobals();
  limparCacheModelo();
});

/** Corpo de resposta completa (nao-stream) no formato do backend. */
function respostaChat(texto: string, modelo = "qwen2.5-vl-3b-instruct", tokens = 20) {
  return {
    ok: true,
    json: async () => ({
      model: modelo,
      choices: [{ message: { role: "assistant", content: texto }, finish_reason: "stop" }],
      usage: { completion_tokens: tokens },
    }),
  };
}

/** Monta um corpo de stream SSE a partir de objetos por linha. */
function sse(...linhas: object[]): string {
  return (
    linhas.map((l) => `data: ${JSON.stringify(l)}`).join("\n") + "\ndata: [DONE]\n"
  );
}

describe("extrairBase64", () => {
  it("remove o prefixo data URL", () => {
    expect(extrairBase64("data:image/jpeg;base64,AAAA")).toBe("AAAA");
  });

  it("mantem base64 puro", () => {
    expect(extrairBase64("AAAA")).toBe("AAAA");
  });
});

describe("prompts", () => {
  it("montarPromptDescricao devolve o prompt de descricao", () => {
    expect(montarPromptDescricao()).toBe(PROMPT_DESCRICAO);
    expect(PROMPT_DESCRICAO).toContain("UMA foto");
  });

  it("montarPromptRoteiro escolhe base ou delta", () => {
    expect(montarPromptRoteiro(true, "")).toBe(PROMPT_ROTEIRO_BASE);
    expect(montarPromptRoteiro(false, "Pessoa de pe.")).toBe(PROMPT_ROTEIRO_DELTA);
    expect(PROMPT_ROTEIRO_BASE).toContain("PRIMEIRO");
  });
});

describe("gerarDescricao", () => {
  it("envia a requisicao e devolve a descricao", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaChat("Uma pessoa sentada.", "m", 20));
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await gerarDescricao("data:image/jpeg;base64,QkxPQ", {
      baseUrl: "http://localhost:1234",
      modelo: "m",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:1234/v1/chat/completions");
    const corpo = JSON.parse(String(init.body));
    expect(corpo.model).toBe("m");
    expect(corpo.messages[0].content).toEqual([
      { type: "text", text: PROMPT_DESCRICAO },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,QkxPQ" } },
    ]);
    expect(corpo.stream).toBe(false);
    expect(corpo.max_tokens).toBe(256);
    expect(corpo.temperature).toBe(0.2);
    expect(corpo.top_p).toBe(0.9);

    expect(resultado.texto).toBe("Uma pessoa sentada.");
    expect(resultado.modelo).toBe("m");
    expect(resultado.tokens).toBe(20);
    expect(resultado.duracaoMs).toBeGreaterThanOrEqual(0);
  });

  it("lanca erro quando o modelo deriva sem responder (thinking)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          model: "m",
          choices: [{ delta: { reasoning_content: "Hmm..." }, finish_reason: "stop" }],
        }),
      })
    );

    await expect(gerarDescricao("AAAA", { modelo: "m" })).rejects.toThrow(
      /derivou\/raciocinou sem produzir resposta/
    );
  });

  it("lanca erro quando o status nao e ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => "model not found" })
    );

    await expect(gerarDescricao("AAAA", { modelo: "inexistente" })).rejects.toThrow(/404/);
  });

  it("lanca erro quando a resposta traz um erro", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ error: "model not loaded" }) })
    );

    await expect(gerarDescricao("AAAA", { modelo: "x" })).rejects.toThrow(/model not loaded/);
  });
});

describe("gerarDescricaoStream", () => {
  it("emite os pedacos da resposta e o resumo final", async () => {
    const corpo = sse(
      { model: "m", choices: [{ delta: { content: "Uma " } }] },
      {
        model: "m",
        choices: [{ delta: { content: "pessoa." }, finish_reason: "stop" }],
        usage: { completion_tokens: 7 },
      }
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, body: new Response(corpo).body }));

    const iterator = gerarDescricaoStream("data:image/jpeg;base64,QkxPQ", {
      baseUrl: "http://localhost:1234",
      modelo: "m",
    });

    const partes: string[] = [];
    let resultado = await iterator.next();
    while (!resultado.done) {
      partes.push(resultado.value);
      resultado = await iterator.next();
    }

    expect(partes.join("")).toBe("Uma pessoa.");
    expect(resultado.value).toMatchObject({ modelo: "m", tokens: 7 });
  });

  it("lanca erro quando o modelo so deriva (thinking) sem emitir texto", async () => {
    const corpo = sse(
      { model: "m", choices: [{ delta: { reasoning_content: "Vamos analisar..." } }] },
      { model: "m", choices: [{ delta: {}, finish_reason: "stop" }] }
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, body: new Response(corpo).body }));

    const iterator = gerarDescricaoStream("AAAA", { modelo: "m" });
    await expect(iterator.next()).rejects.toThrow(/derivou\/raciocinou sem produzir resposta/);
  });

  it("lanca erro quando o status nao e ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "boom" })
    );

    const iterator = gerarDescricaoStream("AAAA", { modelo: "x" });
    await expect(iterator.next()).rejects.toThrow(/500/);
  });

  it("abortar o sinal cancela o fetch do backend de visao", async () => {
    const sinaisRecebidos: AbortSignal[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: unknown, init?: RequestInit) => {
        const sinal = init?.signal;
        sinaisRecebidos.push(sinal as AbortSignal);
        return new Promise((_resolve, reject) => {
          if (sinal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
          }
          sinal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError"))
          );
        });
      })
    );

    const controle = new AbortController();
    const iterator = gerarDescricaoStream("AAAA", { modelo: "x", signal: controle.signal });
    const pendente = iterator.next();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sinaisRecebidos).toHaveLength(1);
    expect(sinaisRecebidos[0].aborted).toBe(false);

    controle.abort();
    await expect(pendente).rejects.toThrow(/Aborted/);
    expect(sinaisRecebidos[0].aborted).toBe(true);
  });

  it("lanca erro quando o stream emite um evento de erro", async () => {
    const corpo = sse({ error: "model not loaded" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, body: new Response(corpo).body }));

    const iterator = gerarDescricaoStream("AAAA", { modelo: "x" });
    await expect(iterator.next()).rejects.toThrow(/model not loaded/);
  });
});

describe("modelosEmMemoria", () => {
  it("lista apenas os modelos com state loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: "qwen2.5-vl-3b-instruct", state: "loaded" },
            { id: "llava", state: "not-loaded" },
          ],
        }),
      })
    );

    const memoria = await modelosEmMemoria({ baseUrl: "http://localhost:1234" });
    expect(memoria).toEqual(["qwen2.5-vl-3b-instruct"]);
  });

  it("aceita modelos sem o campo state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: "m" }] }) })
    );
    await expect(modelosEmMemoria()).resolves.toEqual(["m"]);
  });

  it("retorna lista vazia quando o endpoint falha", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(modelosEmMemoria()).resolves.toEqual([]);
  });
});

describe("normalizarNomeModelo", () => {
  it("preserva o nome, apenas removendo espacos", () => {
    expect(normalizarNomeModelo("qwen2.5-vl-3b-instruct")).toBe("qwen2.5-vl-3b-instruct");
    expect(normalizarNomeModelo("  qwen2.5-vl-3b-instruct  ")).toBe("qwen2.5-vl-3b-instruct");
  });

  it("retorna vazio para nome vazio", () => {
    expect(normalizarNomeModelo("")).toBe("");
    expect(normalizarNomeModelo("   ")).toBe("");
  });
});

describe("mesmoModelo", () => {
  it("ignora caixa e espacos", () => {
    expect(mesmoModelo("Qwen2.5-VL-3B", "qwen2.5-vl-3b")).toBe(true);
    expect(mesmoModelo(" qwen2.5-vl-3b ", "qwen2.5-vl-3b")).toBe(true);
  });

  it("distingue modelos diferentes", () => {
    expect(mesmoModelo("qwen2.5-vl-3b", "qwen2.5-vl-7b")).toBe(false);
  });

  it("retorna falso quando algum nome e vazio", () => {
    expect(mesmoModelo("", "")).toBe(false);
    expect(mesmoModelo("", "qwen2.5-vl-3b")).toBe(false);
  });
});

describe("melhorModeloDisponivel", () => {
  it("prefere o modelo de visao configurado aos demais", () => {
    expect(melhorModeloDisponivel(["llava", "qwen2.5-vl-3b-instruct"])).toBe(
      "qwen2.5-vl-3b-instruct"
    );
  });

  it("prefere um modelo de visao conhecido a um desconhecido", () => {
    expect(melhorModeloDisponivel(["foo", "llava"])).toBe("llava");
  });

  it("usa o primeiro da lista quando nenhum prefixo conhecido casa", () => {
    expect(melhorModeloDisponivel(["foo", "bar"])).toBe("foo");
  });

  it("devolve vazio quando nao ha instalados", () => {
    expect(melhorModeloDisponivel([])).toBe("");
  });
});

describe("modelosInstalados", () => {
  it("lista os modelos via /v1/models", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "qwen2.5-vl-3b-instruct" }, { id: "llava" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(modelosInstalados({ baseUrl: "http://localhost:1234" })).resolves.toEqual([
      "qwen2.5-vl-3b-instruct",
      "llava",
    ]);
    expect(String(fetchMock.mock.calls[0][0])).toBe("http://localhost:1234/v1/models");
  });

  it("devolve lista vazia quando /v1/models falha", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(modelosInstalados()).resolves.toEqual([]);
  });
});

describe("escolherModelo", () => {
  it("respeita modelo explicito sem consultar o backend", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(escolherModelo({ modelo: "qwen2.5-vl-3b-instruct" })).resolves.toEqual({
      solicitado: "qwen2.5-vl-3b-instruct",
      modelo: "qwen2.5-vl-3b-instruct",
      alternativo: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("mantem o padrao quando ele esta instalado", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: MODELO_PADRAO }] }) })
    );
    await expect(escolherModelo()).resolves.toEqual({
      solicitado: MODELO_PADRAO,
      modelo: MODELO_PADRAO,
      alternativo: false,
    });
  });

  it("usa o melhor disponivel quando o padrao falta", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: "llava" }] }) })
    );
    await expect(escolherModelo()).resolves.toEqual({
      solicitado: MODELO_PADRAO,
      modelo: "llava",
      alternativo: true,
    });
  });

  it("mantem o configurado quando o backend esta offline", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(escolherModelo()).resolves.toMatchObject({
      solicitado: MODELO_PADRAO,
      modelo: MODELO_PADRAO,
      alternativo: false,
    });
  });

  it("cacheia a escolha entre chamadas", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: "llava" }] }) });
    vi.stubGlobal("fetch", fetchMock);
    await escolherModelo();
    await escolherModelo();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("modeloEmMemoria", () => {
  it("confirma apenas o modelo solicitado", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ id: "qwen2.5-vl-3b-instruct", state: "loaded" }] }),
      })
    );

    await expect(modeloEmMemoria({ modelo: "qwen2.5-vl-3b-instruct" })).resolves.toBe(true);
    await expect(modeloEmMemoria({ modelo: "qwen2.5-vl-7b" })).resolves.toBe(false);
  });

  it("nao informa carregado quando a memoria esta vazia", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) })
    );

    await expect(modeloEmMemoria({ modelo: "qwen2.5-vl-3b-instruct" })).resolves.toBe(false);
  });
});

describe("forcarCarregamento", () => {
  it("nao chama o chat quando o modelo ja esta em memoria", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "m", state: "loaded" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const carga = await forcarCarregamento({ modelo: "m" });
    expect(carga).toBe(0);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/chat/completions"))).toBe(
      false
    );
  });

  it("carrega o modelo quando nao esta em memoria e espera confirma-lo", async () => {
    const calls: string[] = [];
    let psCount = 0;
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push(url);
      if (url.includes("/api/v0/models")) {
        psCount += 1;
        return {
          ok: true,
          json: async () =>
            psCount > 1
              ? { data: [{ id: "m", state: "loaded" }] }
              : { data: [] },
        };
      }
      if (url.includes("/chat/completions")) {
        return { ok: true, json: async () => ({ choices: [{ message: { content: "oi" } }] }) };
      }
      throw new Error(`URL inesperada: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const carga = await forcarCarregamento({ modelo: "m" });
    expect(carga).toBeGreaterThanOrEqual(0);
    expect(calls.some((u) => u.includes("/chat/completions"))).toBe(true);
    expect(calls.filter((u) => u.includes("/api/v0/models")).length).toBeGreaterThanOrEqual(2);
  });

  it("lanca erro quando a carga falha", async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/api/v0/models")) return { ok: true, json: async () => ({ data: [] }) };
      if (url.includes("/chat/completions"))
        return { ok: false, status: 404, text: async () => "model not found" };
      throw new Error("unexpected");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(forcarCarregamento({ modelo: "x" })).rejects.toThrow(/404/);
  });

  it("nao entra em polling quando o backend nao expoe a memoria", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push(url);
      if (url.includes("/api/v0/models")) return { ok: false, status: 404, json: async () => ({}) };
      if (url.includes("/chat/completions")) {
        return { ok: true, json: async () => ({ choices: [{ message: { content: "oi" } }] }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const inicio = Date.now();
    const carga = await forcarCarregamento({ modelo: "m", baseUrl: "http://localhost:1234" });
    expect(Date.now() - inicio).toBeLessThan(2000);
    expect(carga).toBeGreaterThanOrEqual(0);
    expect(calls.some((u) => u.includes("/chat/completions"))).toBe(true);
    expect(calls.filter((u) => u.includes("/api/v0/models")).length).toBeLessThanOrEqual(2);
  });
});

describe("memoriaIntrospectavel", () => {
  it("confirma quando o endpoint de memoria responde", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) })
    );
    await expect(memoriaIntrospectavel()).resolves.toBe(true);
  });

  it("nao confirma quando o endpoint de memoria falha", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(memoriaIntrospectavel()).resolves.toBe(false);
  });
});

describe("gerarDescricao no modo roteiro", () => {
  it("frame base usa num_predict de base e prompt de base", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaChat("Base detalhada.", "m", 30));
    vi.stubGlobal("fetch", fetchMock);

    await gerarDescricao("AAAA", { modelo: "m", modo: "roteiro", base: true, roteiro: "" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const corpo = JSON.parse(String(init.body));
    // A imagem vai como bloco: o texto e o primeiro item do array de conteudo.
    expect(corpo.messages[0].content[0]).toMatchObject({ type: "text", text: PROMPT_ROTEIRO_BASE });
    expect(corpo.max_tokens).toBe(NUM_PREDICT_BASE);
  });

  it("delta usa num_predict reduzido e prompt de delta", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaChat("Pessoa sentou.", "m", 8));
    vi.stubGlobal("fetch", fetchMock);

    await gerarDescricao("AAAA", { modelo: "m", modo: "roteiro", base: false, roteiro: "Pessoa de pe." });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const corpo = JSON.parse(String(init.body));
    expect(corpo.messages[0].content[0]).toMatchObject({ type: "text", text: PROMPT_ROTEIRO_DELTA });
    expect(corpo.max_tokens).toBe(NUM_PREDICT_DELTA);
  });
});
