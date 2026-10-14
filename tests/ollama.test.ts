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
  MODELO_PADRAO,
  PROMPT_DESCRICAO,
  PROMPT_ROTEIRO_BASE,
  PROMPT_ROTEIRO_DELTA,
} from "../src/ollama";

afterEach(() => {
  vi.unstubAllGlobals();
  limparCacheModelo();
});

describe("extrairBase64", () => {
  it("remove o prefixo data URL", () => {
    expect(extrairBase64("data:image/jpeg;base64,AAAA")).toBe("AAAA");
  });

  it("mantem base64 puro", () => {
    expect(extrairBase64("AAAA")).toBe("AAAA");
  });
});

describe("montarPromptDescricao", () => {
  it("usa o prompt base sem contexto anterior", () => {
    expect(montarPromptDescricao()).toBe(PROMPT_DESCRICAO);
    expect(montarPromptDescricao()).toBe(PROMPT_DESCRICAO);
  });

  it("inclui a descricao anterior e pede detalhes em vez de repetir", () => {
    const prompt = montarPromptDescricao();
    expect(prompt).toContain("Uma pessoa sentada");
    expect(prompt).toContain("NAO repita");
    expect(prompt).toContain("detalhes adicionais");
    expect(prompt).toContain("partes do corpo");
  });
});

describe("gerarDescricao", () => {
  it("envia a requisicao correta e devolve a descricao", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: { role: "assistant", content: "Uma pessoa sentada." },
        model: "qwen3-vl:4b",
        eval_count: 20,
        total_duration: 3_000_000_000,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await gerarDescricao("data:image/jpeg;base64,QkxPQ", {
      host: "http://localhost:11434",
      modelo: "qwen3-vl:4b",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:11434/api/chat");
    const corpo = JSON.parse(String(init.body));
    expect(corpo.model).toBe("qwen3-vl:4b");
    expect(corpo.messages[0].content).toBe(PROMPT_DESCRICAO);
    expect(corpo.messages[0].images).toEqual(["QkxPQ"]);
    expect(corpo.stream).toBe(false);
    expect(corpo.think).toBe(false);
    expect(corpo.options.think).toBeUndefined();
    expect(corpo.options.num_predict).toBe(256);
    expect(corpo.options.temperature).toBe(0.2);

    expect(resultado.texto).toBe("Uma pessoa sentada.");
    expect(resultado.modelo).toBe("qwen3-vl:4b");
    expect(resultado.tokens).toBe(20);
    expect(resultado.duracaoMs).toBe(3000);
  });

  it("lança erro quando o modelo derivou sem responder (thinking)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          message: { content: "", thinking: "Hmm, let me reason about..." },
          model: "qwen3-vl:4b",
          eval_count: 40,
        }),
      })
    );

    await expect(gerarDescricao("AAAA", { modelo: "qwen3-vl:4b" })).rejects.toThrow(
      /derivou\/raciocinou sem produzir resposta/
    );
  });

  it("lanca erro quando o status nao e ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => "model not found",
      })
    );

    await expect(gerarDescricao("AAAA", { modelo: "inexistente" })).rejects.toThrow(/404/);
  });
});

describe("gerarDescricaoStream", () => {
  it("emite os pedacos da resposta e o resumo final", async () => {
    const ndjson =
      [
        JSON.stringify({ message: { content: "Uma " }, model: "qwen3-vl:4b" }),
        JSON.stringify({
          message: { content: "pessoa." },
          model: "qwen3-vl:4b",
          eval_count: 7,
          total_duration: 1_500_000_000,
          done: true,
        }),
      ].join("\n") + "\n";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, body: new Response(ndjson).body }));

    const iterator = gerarDescricaoStream("data:image/jpeg;base64,QkxPQ", {
      host: "http://localhost:11434",
      modelo: "qwen3-vl:4b",
    });

    const partes: string[] = [];
    let resultado = await iterator.next();
    while (!resultado.done) {
      partes.push(resultado.value);
      resultado = await iterator.next();
    }

    expect(partes.join("")).toBe("Uma pessoa.");
    expect(resultado.value).toMatchObject({ modelo: "qwen3-vl:4b", tokens: 7, duracaoMs: 1500 });
  });

  it("lança erro quando o modelo so deriva (thinking) sem emitir texto", async () => {
    const ndjson =
      [
        JSON.stringify({ message: { thinking: "Vamos analisar..." }, model: "qwen3-vl:4b" }),
        JSON.stringify({ model: "qwen3-vl:4b", eval_count: 10, done: true }),
      ].join("\n") + "\n";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, body: new Response(ndjson).body }));

    const iterator = gerarDescricaoStream("AAAA", { modelo: "qwen3-vl:4b" });
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

  it("abortar o sinal cancela o fetch do Ollama", async () => {
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

  it("lança erro quando o stream emite um evento de erro", async () => {
    const ndjson = JSON.stringify({ error: "model not loaded" }) + "\n";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, body: new Response(ndjson).body }));

    const iterator = gerarDescricaoStream("AAAA", { modelo: "x" });
    await expect(iterator.next()).rejects.toThrow(/model not loaded/);
  });

  it("lanca erro quando o modo nao-stream devolve error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ error: "model not loaded" }),
      })
    );

    await expect(gerarDescricao("AAAA", { modelo: "x" })).rejects.toThrow(/model not loaded/);
  });
});

describe("modelosEmMemoria", () => {
  it("lista os modelos que estao na memoria via /api/ps", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          models: [{ name: "qwen3-vl:4b" }, { name: "llama3.2:3b" }],
        }),
      })
    );

    const memoria = await modelosEmMemoria({ host: "http://localhost:11434" });
    expect(memoria).toEqual(["qwen3-vl:4b", "llama3.2:3b"]);
  });

  it("retorna lista vazia quando /api/ps falha", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(modelosEmMemoria()).resolves.toEqual([]);
  });
});

describe("normalizarNomeModelo", () => {
  it("preserva a tag do modelo", () => {
    expect(normalizarNomeModelo("qwen2.5vl:3b")).toBe("qwen2.5vl:3b");
    expect(normalizarNomeModelo("qwen3-vl:4b")).toBe("qwen3-vl:4b");
  });

  it("trata a ausencia de tag como latest", () => {
    expect(normalizarNomeModelo("qwen2.5vl")).toBe("qwen2.5vl:latest");
  });

  it("ignora espacos nas extremidades", () => {
    expect(normalizarNomeModelo("  qwen2.5vl:3b  ")).toBe("qwen2.5vl:3b");
  });

  it("nao confunde porta de registry com tag", () => {
    expect(normalizarNomeModelo("localhost:5000/qwen2.5vl")).toBe("localhost:5000/qwen2.5vl:latest");
    expect(normalizarNomeModelo("localhost:5000/qwen2.5vl:3b")).toBe("localhost:5000/qwen2.5vl:3b");
  });

  it("retorna vazio para nome vazio", () => {
    expect(normalizarNomeModelo("")).toBe("");
    expect(normalizarNomeModelo("   ")).toBe("");
  });
});

describe("mesmoModelo", () => {
  it("considera o mesmo modelo com a mesma tag", () => {
    expect(mesmoModelo("qwen2.5vl:3b", "qwen2.5vl:3b")).toBe(true);
  });

  it("distingue modelos com tags diferentes", () => {
    expect(mesmoModelo("qwen2.5vl:3b", "qwen2.5vl:7b")).toBe(false);
    expect(mesmoModelo("qwen2.5vl:3b", "qwen2.5vl:4b")).toBe(false);
  });

  it("equipara nome sem tag a latest", () => {
    expect(mesmoModelo("qwen2.5vl", "qwen2.5vl:latest")).toBe(true);
    expect(mesmoModelo("qwen2.5vl:latest", "qwen2.5vl")).toBe(true);
  });

  it("nao considera um modelo sem tag igual a uma tag concreta", () => {
    expect(mesmoModelo("qwen2.5vl", "qwen2.5vl:3b")).toBe(false);
  });

  it("retorna falso quando algum nome e vazio", () => {
    expect(mesmoModelo("", "")).toBe(false);
    expect(mesmoModelo("", "qwen2.5vl:3b")).toBe(false);
  });
});

describe("melhorModeloDisponivel", () => {
  it("prefere um modelo de visao capaz a um de legenda", () => {
    expect(melhorModeloDisponivel(["qwen2.5vl:3b", "llava:7b"])).toBe("qwen2.5vl:3b");
  });

  it("prefere o qwen2.5vl (nao-pensante) ao qwen3-vl (thinking)", () => {
    expect(melhorModeloDisponivel(["qwen3-vl:4b", "qwen2.5vl:7b"])).toBe("qwen2.5vl:7b");
  });

  it("prefere modelo nao-pensante a um thinking", () => {
    expect(melhorModeloDisponivel(["qwen3-vl:4b", "llava:7b"])).toBe("llava:7b");
  });

  it("usa o primeiro da lista quando nenhum prefixo conhecido casa", () => {
    expect(melhorModeloDisponivel(["foo:1", "bar:2"])).toBe("foo:1");
  });

  it("devolve vazio quando nao ha instalados", () => {
    expect(melhorModeloDisponivel([])).toBe("");
  });
});

describe("modelosInstalados", () => {
  it("lista os modelos via /api/tags", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ models: [{ name: "qwen2.5vl:3b" }, { name: "llava:7b" }] }),
      })
    );
    await expect(modelosInstalados({ host: "http://localhost:11434" })).resolves.toEqual([
      "qwen2.5vl:3b",
      "llava:7b",
    ]);
  });

  it("devolve lista vazia quando /api/tags falha", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(modelosInstalados()).resolves.toEqual([]);
  });
});

describe("escolherModelo", () => {
  it("respeita modelo explicito sem consultar o Ollama", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(escolherModelo({ modelo: "qwen3-vl:4b" })).resolves.toEqual({
      solicitado: "qwen3-vl:4b",
      modelo: "qwen3-vl:4b",
      alternativo: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("mantem o padrao quando ele esta instalado", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ models: [{ name: MODELO_PADRAO }] }),
      })
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
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ models: [{ name: "qwen2.5vl:3b" }] }),
      })
    );
    await expect(escolherModelo()).resolves.toEqual({
      solicitado: MODELO_PADRAO,
      modelo: "qwen2.5vl:3b",
      alternativo: true,
    });
  });

  it("mantem o configurado quando o Ollama esta offline", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(escolherModelo()).resolves.toMatchObject({
      solicitado: MODELO_PADRAO,
      modelo: MODELO_PADRAO,
      alternativo: false,
    });
  });

  it("cacheia a escolha entre chamadas", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: [{ name: "qwen2.5vl:3b" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await escolherModelo();
    await escolherModelo();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("modeloEmMemoria", () => {
  it("confirma apenas o modelo solicitado quando o /api/ps usa name", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ models: [{ name: "qwen2.5vl:3b" }] }),
      })
    );

    await expect(modeloEmMemoria({ modelo: "qwen2.5vl:3b" })).resolves.toBe(true);
    await expect(modeloEmMemoria({ modelo: "qwen2.5vl:7b" })).resolves.toBe(false);
  });

  it("aceita os nomes retornados por /api/ps no campo model", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ models: [{ model: "qwen2.5vl:3b" }] }),
      })
    );

    await expect(modeloEmMemoria({ modelo: "qwen2.5vl:3b" })).resolves.toBe(true);
  });

  it("equipara nome sem tag a latest em /api/ps", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ models: [{ name: "qwen2.5vl:latest" }] }),
      })
    );

    await expect(modeloEmMemoria({ modelo: "qwen2.5vl" })).resolves.toBe(true);
  });

  it("nao informa carregado quando a memoria esta vazia", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }) })
    );

    await expect(modeloEmMemoria({ modelo: "qwen2.5vl:3b" })).resolves.toBe(false);
  });
});

describe("forcarCarregamento", () => {
  it("nao chama o generate quando o modelo ja esta em memoria", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ models: [{ name: "qwen3-vl:4b" }] }) });
    vi.stubGlobal("fetch", fetchMock);

    const carga = await forcarCarregamento({ modelo: "qwen3-vl:4b" });
    expect(carga).toBe(0);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/api/chat"))).toBe(false);
  });

  it("carrega o modelo quando nao esta em memoria e espera o /api/ps confirma-lo", async () => {
    const calls: string[] = [];
    let psCount = 0;
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push(url);
      if (url.includes("/api/ps")) {
        psCount += 1;
        return {
          ok: true,
          json: async () =>
            psCount > 1 ? { models: [{ name: "qwen3-vl:4b" }] } : { models: [] },
        };
      }
      if (url.includes("/api/chat")) {
        return { ok: true, json: async () => ({ message: { content: "oi" } }) };
      }
      throw new Error(`URL inesperada: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const carga = await forcarCarregamento({ modelo: "qwen3-vl:4b" });
    expect(carga).toBeGreaterThanOrEqual(0);
    expect(calls.some((u) => u.includes("/api/chat"))).toBe(true);
    expect(calls.filter((u) => u.includes("/api/ps")).length).toBeGreaterThanOrEqual(2);
  });

  it("lanca erro quando a carga falha", async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/api/ps")) return { ok: true, json: async () => ({ models: [] }) };
      if (url.includes("/api/chat")) return { ok: false, status: 404, text: async () => "model not found" };
      throw new Error("unexpected");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(forcarCarregamento({ modelo: "x" })).rejects.toThrow(/404/);
  });

  it("nao entra em polling quando o backend OpenAI nao expoe a memoria", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push(url);
      if (url.includes("/api/v0/models")) return { ok: false, status: 404, json: async () => ({}) };
      if (url.includes("/v1/chat/completions")) {
        return { ok: true, json: async () => ({ choices: [{ message: { content: "oi" } }] }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const inicio = Date.now();
    const carga = await forcarCarregamento({
      modelo: "m",
      provedor: "openai",
      baseUrl: "http://localhost:1234",
    });
    expect(Date.now() - inicio).toBeLessThan(2000);
    expect(carga).toBeGreaterThanOrEqual(0);
    expect(calls.some((u) => u.includes("/v1/chat/completions"))).toBe(true);
    expect(calls.filter((u) => u.includes("/api/v0/models")).length).toBeLessThanOrEqual(2);
  });
});

describe("memoriaIntrospectavel", () => {
  it("confirma quando o endpoint de memoria responde", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }) })
    );
    await expect(memoriaIntrospectavel({ provedor: "ollama" })).resolves.toBe(true);
  });

  it("nao confirma quando o endpoint de memoria falha", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(memoriaIntrospectavel({ provedor: "openai" })).resolves.toBe(false);
  });
});

describe("montarPromptRoteiro", () => {
  it("usado no frame base retorna o prompt de base", () => {
    expect(montarPromptRoteiro(true, "")).toBe(PROMPT_ROTEIRO_BASE);
    expect(PROMPT_ROTEIRO_BASE).toContain("profunda");
  });

  it("usado em delta embute o roteiro acumulado", () => {
    const prompt = montarPromptRoteiro(false, "Pessoa de pe. Braco esquerdo levantado.");
    expect(prompt).toContain(PROMPT_ROTEIRO_DELTA);
    expect(prompt).toContain("Pessoa de pe. Braco esquerdo levantado.");
    expect(prompt).toContain("Roteiro ate agora");
  });

  it("usado em delta sem roteiro mantem o prompt de delta", () => {
    expect(montarPromptRoteiro(false, "")).toBe(PROMPT_ROTEIRO_DELTA);
  });
});

describe("gerarDescricao no modo roteiro", () => {
  it("frame base usa num_predict padrao e prompt de base", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: { content: "Base detalhada." },
        model: "qwen2.5vl:3b",
        eval_count: 30,
        total_duration: 2_000_000_000,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await gerarDescricao("AAAA", {
      modelo: "qwen2.5vl:3b",
      modo: "roteiro",
      base: true,
      roteiro: "",
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const corpo = JSON.parse(String(init.body));
    expect(corpo.messages[0].content).toBe(PROMPT_ROTEIRO_BASE);
    expect(corpo.options.num_predict).toBe(NUM_PREDICT_BASE);
    expect(corpo.options.repeat_penalty).toBe(1.3);
  });

  it("delta usa num_predict reduzido e prompt com roteiro", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: { content: "Pessoa sentou." },
        model: "qwen2.5vl:3b",
        eval_count: 8,
        total_duration: 1_000_000_000,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await gerarDescricao("AAAA", {
      modelo: "qwen2.5vl:3b",
      modo: "roteiro",
      base: false,
      roteiro: "Pessoa de pe.",
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const corpo = JSON.parse(String(init.body));
    expect(corpo.messages[0].content).toContain("Pessoa de pe.");
    expect(corpo.options.num_predict).toBe(160);
  });
});
