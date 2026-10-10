import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extrairBase64,
  gerarDescricao,
  gerarDescricaoStream,
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
        response: "Uma pessoa sentada.",
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
    expect(url).toBe("http://localhost:11434/api/generate");
    const corpo = JSON.parse(String(init.body));
    expect(corpo.model).toBe("qwen3-vl:4b");
    expect(corpo.images).toEqual(["QkxPQ"]);
    expect(corpo.stream).toBe(false);
    expect(corpo.options.think).toBe(false);
    expect(corpo.options.temperature).toBe(0.2);
    expect(corpo.prompt).toBe(PROMPT_DESCRICAO);

    expect(resultado.texto).toBe("Uma pessoa sentada.");
    expect(resultado.modelo).toBe("qwen3-vl:4b");
    expect(resultado.tokens).toBe(20);
    expect(resultado.duracaoMs).toBe(3000);
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
        JSON.stringify({ response: "Uma ", model: "qwen3-vl:4b" }),
        JSON.stringify({
          response: "pessoa.",
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

  it("lanca erro quando o status nao e ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "boom" })
    );

    const iterator = gerarDescricaoStream("AAAA", { modelo: "x" });
    await expect(iterator.next()).rejects.toThrow(/500/);
  });
});