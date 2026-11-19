import { afterEach, describe, expect, it, vi } from "vitest";
import {
  gerarDescricaoStream,
  limparCacheModelo,
} from "../../src/visao";
import { sse } from "../helpers/visao";

afterEach(() => {
  vi.unstubAllGlobals();
  limparCacheModelo();
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

  it("processa a ultima linha SSE quando o stream termina sem quebra de linha", async () => {
    const corpo = `data: ${JSON.stringify({
      model: "m",
      choices: [{ delta: { content: "Uma pessoa." }, finish_reason: "stop" }],
      usage: { completion_tokens: 7 },
    })}`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, body: new Response(corpo).body }));

    const iterator = gerarDescricaoStream("data:image/jpeg;base64,QkxPQ", {
      baseUrl: "http://localhost:1234",
      modelo: "m",
    });

    await expect(iterator.next()).resolves.toEqual({ done: false, value: "Uma pessoa." });
    await expect(iterator.next()).resolves.toMatchObject({
      done: true,
      value: { modelo: "m", tokens: 7 },
    });
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

  it("aponta o limite de tokens do backend quando a resposta foi truncada", async () => {
    const corpo = sse(
      { model: "m", choices: [{ delta: { reasoning_content: "Pensando..." } }] },
      { model: "m", choices: [{ delta: {}, finish_reason: "length" }] }
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, body: new Response(corpo).body }));

    const iterator = gerarDescricaoStream("AAAA", { modelo: "m" });
    await expect(iterator.next()).rejects.toThrow(/limite de tokens/);
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