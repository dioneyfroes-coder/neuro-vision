import { afterEach, describe, expect, it, vi } from "vitest";
import {
  gerarDescricaoStream,
  limparCacheModelo,
  PROMPT_ANALISE_PROFUNDA,
  PROMPT_ROTEIRO_BASE,
  PROMPT_ROTEIRO_DELTA,
} from "../../src/visao";
import { sse } from "../helpers/visao";

afterEach(() => {
  vi.unstubAllGlobals();
  limparCacheModelo();
});

describe("requisicao no modo roteiro", () => {
  /** Dispara o fetch do generator e devolve o corpo enviado ao backend. */
  async function corpoDaRequisicao(opcoes: { base: boolean; roteiro: string }) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: new Response(
        sse({ model: "m", choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] })
      ).body,
    });
    vi.stubGlobal("fetch", fetchMock);
    const iterator = gerarDescricaoStream("AAAA", {
      modelo: "m",
      modo: "roteiro",
      base: opcoes.base,
      roteiro: opcoes.roteiro,
    });
    while (!(await iterator.next()).done) {
      // Esgota o gerador para disparar a requisicao.
    }
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return JSON.parse(String(init.body));
  }

  it("frame base pede analise profunda e nao fixa limite de tokens", async () => {
    const corpo = await corpoDaRequisicao({ base: true, roteiro: "" });
    // A imagem vai como bloco: o texto e o primeiro item do array de conteudo.
    expect(corpo.messages[0].content[0]).toMatchObject({
      type: "text",
      text: `${PROMPT_ROTEIRO_BASE}\n\n${PROMPT_ANALISE_PROFUNDA}`,
    });
    expect(corpo).not.toHaveProperty("max_tokens");
  });

  it("delta pede analise profunda sem reduzir a descricao a uma frase", async () => {
    const corpo = await corpoDaRequisicao({ base: false, roteiro: "Pessoa de pe." });
    expect(corpo.messages[0].content[0]).toMatchObject({
      type: "text",
      text: `${PROMPT_ROTEIRO_DELTA}\n\n${PROMPT_ANALISE_PROFUNDA}`,
    });
    expect(corpo).not.toHaveProperty("max_tokens");
  });
});