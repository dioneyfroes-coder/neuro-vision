import { afterEach, describe, expect, it, vi } from "vitest";
import {
  gerarDescricaoStream,
  limparCacheModelo,
  montarPromptDescricao,
  PROMPT_ANALISE_PROFUNDA,
  PROMPT_DESCRICAO,
} from "../../src/visao";
import { sse } from "../helpers/visao";

afterEach(() => {
  vi.unstubAllGlobals();
  limparCacheModelo();
});

describe("montagem da requisicao (via stream)", () => {
  it("envia prompt, imagem e parametros padrao no corpo", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: new Response(
        sse({
          model: "m",
          choices: [{ delta: { content: "Uma pessoa sentada." }, finish_reason: "stop" }],
          usage: { completion_tokens: 20 },
        })
      ).body,
    });
    vi.stubGlobal("fetch", fetchMock);

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

    expect(partes.join("")).toBe("Uma pessoa sentada.");
    expect(resultado.value).toMatchObject({ modelo: "m", tokens: 20 });
    expect(resultado.value.duracaoMs).toBeGreaterThanOrEqual(0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:1234/v1/chat/completions");
    const corpo = JSON.parse(String(init.body));
    expect(corpo.model).toBe("m");
    expect(corpo.messages[0].content).toEqual([
      { type: "text", text: montarPromptDescricao() },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,QkxPQ" } },
    ]);
    expect(corpo.stream).toBe(true);
    expect(corpo).not.toHaveProperty("max_tokens");
    expect(corpo.temperature).toBe(0.2);
    expect(corpo.top_p).toBe(0.9);
  });
  it("anexa o bloco NSFW ao prompt padrao e preserva prompt explicito", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => ({
      ok: true,
      body: new Response(
        sse({
          model: "m",
          choices: [{ delta: { content: "Conteudo adulto descrito." }, finish_reason: "stop" }],
          usage: { completion_tokens: 5 },
        })
      ).body,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const nsfw = [
      {
        rotulo: "porn",
        score: 0.9,
        caixa: { xmin: 0.1, ymin: 0.2, xmax: 0.5, ymax: 0.8 },
      },
    ];
    const drenar = async (iterador: AsyncGenerator<string, unknown, void>) => {
      let passo = await iterador.next();
      while (!passo.done) passo = await iterador.next();
    };

    await drenar(
      gerarDescricaoStream("data:image/jpeg;base64,QkxPQ", {
        baseUrl: "http://localhost:1234",
        modelo: "m",
        nsfw,
      })
    );
    let corpo = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    let texto = corpo.messages[0].content[0].text as string;
    expect(texto).toContain(PROMPT_DESCRICAO);
    expect(texto).toContain("CONTEUDO ADULTO (NSFW)");
    expect(texto).toContain("porn 0.900");
    expect(texto).toMatch(/sem eufemismos/i);

    fetchMock.mockClear();
    await drenar(
      gerarDescricaoStream("data:image/jpeg;base64,QkxPQ", {
        baseUrl: "http://localhost:1234",
        modelo: "m",
        prompt: "Prompt customizado do ciclo multiframe.",
        nsfw,
      })
    );
    corpo = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    texto = corpo.messages[0].content[0].text as string;
    expect(corpo).not.toHaveProperty("max_tokens");
    // O prompt explicito ja traz o proprio bloco NSFW; nao duplica.
    expect(texto).toBe(`Prompt customizado do ciclo multiframe.\n\n${PROMPT_ANALISE_PROFUNDA}`);
  });
});