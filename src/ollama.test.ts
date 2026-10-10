import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extrairBase64,
  forcarCarregamento,
  gerarDescricao,
  gerarDescricaoStream,
  modelosEmMemoria,
  montarPromptDescricao,
  PROMPT_DESCRICAO,
} from "./ollama";

afterEach(() => {
  vi.unstubAllGlobals();
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
    expect(montarPromptDescricao("   ")).toBe(PROMPT_DESCRICAO);
  });

  it("inclui a descricao anterior e pede detalhes em vez de repetir", () => {
    const prompt = montarPromptDescricao("Uma pessoa sentada.");
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
});