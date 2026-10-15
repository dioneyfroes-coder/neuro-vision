import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BASE_URL_PADRAO,
  cabecalhos,
  extrairBase64,
  interpretarChat,
  interpretarLinha,
  montarRequisicaoChat,
  paraDataUrl,
  raizApi,
  resolverBackend,
  urlChat,
  urlDaImagem,
  urlEmMemoria,
  urlModelos,
} from "../src/provedor";

const VARIAVEIS = ["NEURO_BASE_URL", "NEURO_API_KEY", "NEURO_IMG_BASE64_CRU"];

let ambienteAnterior: Record<string, string | undefined> = {};

beforeEach(() => {
  ambienteAnterior = {};
  for (const chave of VARIAVEIS) {
    ambienteAnterior[chave] = process.env[chave];
    delete process.env[chave];
  }
});

afterEach(() => {
  for (const chave of VARIAVEIS) {
    const valor = ambienteAnterior[chave];
    if (valor === undefined) delete process.env[chave];
    else process.env[chave] = valor;
  }
  vi.unstubAllGlobals();
});

describe("resolverBackend", () => {
  it("usa a URL padrao quando nada esta configurado", () => {
    expect(resolverBackend()).toMatchObject({ baseUrl: BASE_URL_PADRAO });
    expect(resolverBackend().apiKey).toBeUndefined();
  });

  it("da prioridade a NEURO_BASE_URL sobre o padrao", () => {
    process.env.NEURO_BASE_URL = "http://outro:9999/";
    expect(resolverBackend().baseUrl).toBe("http://outro:9999");
  });

  it("aceita uma URL base explicita nas opcoes", () => {
    process.env.NEURO_BASE_URL = "http://ignorada:1";
    expect(resolverBackend({ baseUrl: "http://explicita:2" }).baseUrl).toBe("http://explicita:2");
  });

  it("le a chave de API do ambiente", () => {
    process.env.NEURO_API_KEY = "secreta";
    expect(resolverBackend().apiKey).toBe("secreta");
  });

  it("trata chave vazia como ausente", () => {
    expect(resolverBackend({ apiKey: "" }).apiKey).toBeUndefined();
  });
});

describe("raizApi", () => {
  it("separa a versao /v1 da raiz", () => {
    expect(raizApi("http://localhost:1234/v1")).toEqual({
      raiz: "http://localhost:1234",
      versao: "/v1",
    });
  });

  it("assume /v1 quando a URL nao traz versao", () => {
    expect(raizApi("http://localhost:1234")).toEqual({
      raiz: "http://localhost:1234",
      versao: "/v1",
    });
  });
});

describe("URLs do backend", () => {
  it("monta as URLs sem duplicar /v1", () => {
    const backend = resolverBackend({ baseUrl: "http://host:1234/v1" });
    expect(urlChat(backend)).toBe("http://host:1234/v1/chat/completions");
    expect(urlModelos(backend)).toBe("http://host:1234/v1/models");
    expect(urlEmMemoria(backend)).toBe("http://host:1234/api/v0/models");
  });

  it("adiciona /v1 quando a base nao traz versao", () => {
    const backend = resolverBackend({ baseUrl: "http://host:1234" });
    expect(urlChat(backend)).toBe("http://host:1234/v1/chat/completions");
    expect(urlModelos(backend)).toBe("http://host:1234/v1/models");
  });
});

describe("cabecalhos", () => {
  it("adiciona Authorization quando ha chave", () => {
    const backend = resolverBackend({ apiKey: "k" });
    expect(cabecalhos(backend)).toMatchObject({ Authorization: "Bearer k" });
  });

  it("omite Authorization sem chave", () => {
    const backend = resolverBackend();
    expect(cabecalhos(backend).Authorization).toBeUndefined();
  });
});

describe("imagem", () => {
  it("remove o prefixo data URL", () => {
    expect(extrairBase64("data:image/jpeg;base64,AAAA")).toBe("AAAA");
    expect(extrairBase64("AAAA")).toBe("AAAA");
  });

  it("converte base64 cru em data URL", () => {
    expect(paraDataUrl("AAAA")).toBe("data:image/jpeg;base64,AAAA");
    expect(paraDataUrl("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
  });

  it("envia base64 cru quando NEURO_IMG_BASE64_CRU=1", () => {
    expect(urlDaImagem("data:image/jpeg;base64,AAAA")).toBe("data:image/jpeg;base64,AAAA");
    process.env.NEURO_IMG_BASE64_CRU = "1";
    expect(urlDaImagem("data:image/jpeg;base64,AAAA")).toBe("AAAA");
  });
});

describe("montarRequisicaoChat", () => {
  it("monta o corpo com bloco image_url (data URL)", () => {
    const backend = resolverBackend({ baseUrl: "http://localhost:1234" });
    const { url, body } = montarRequisicaoChat({
      backend,
      modelo: "qwen2.5-vl-3b-instruct",
      prompt: "descreva",
      imagem: "AAAA",
      stream: false,
      numPredict: 128,
    });
    expect(url).toBe("http://localhost:1234/v1/chat/completions");
    const json = JSON.parse(body);
    expect(json.max_tokens).toBe(128);
    expect(json.temperature).toBe(0.2);
    expect(json.top_p).toBe(0.9);
    expect(json.messages[0].content).toEqual([
      { type: "text", text: "descreva" },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } },
    ]);
  });

  it("usa as opcoes de amostragem informadas", () => {
    const backend = resolverBackend();
    const { body } = montarRequisicaoChat({
      backend,
      modelo: "m",
      prompt: "p",
      stream: false,
      amostragem: { temperature: 0, top_p: 0.5 },
    });
    const json = JSON.parse(body);
    expect(json.temperature).toBe(0);
    expect(json.top_p).toBe(0.5);
  });

  it("pede usage no stream", () => {
    const backend = resolverBackend();
    const { body } = montarRequisicaoChat({
      backend,
      modelo: "m",
      prompt: "p",
      stream: true,
    });
    expect(JSON.parse(body).stream_options).toEqual({ include_usage: true });
  });

  it("envia prompt puro quando nao ha imagem", () => {
    const backend = resolverBackend();
    const { body } = montarRequisicaoChat({
      backend,
      modelo: "m",
      prompt: "texto",
      stream: false,
    });
    expect(JSON.parse(body).messages[0].content).toBe("texto");
  });
});

describe("interpretarChat", () => {
  it("le um delta e o uso", () => {
    const evt = interpretarChat({
      model: "m",
      choices: [{ delta: { content: "Uma" }, finish_reason: null }],
      usage: { completion_tokens: 5 },
    });
    expect(evt).toMatchObject({ texto: "Uma", tokens: 5, done: false });
  });

  it("le a mensagem completa (nao-stream)", () => {
    const evt = interpretarChat({
      model: "qwen2.5-vl-3b-instruct",
      choices: [{ message: { content: "Uma pessoa." }, finish_reason: "stop" }],
    });
    expect(evt).toMatchObject({
      texto: "Uma pessoa.",
      modelo: "qwen2.5-vl-3b-instruct",
      done: true,
    });
  });

  it("sinaliza thinking/reasoning", () => {
    const evt = interpretarChat({ choices: [{ delta: { reasoning_content: "hmm" } }] });
    expect(evt.pensou).toBe(true);
    expect(evt.texto).toBeUndefined();
  });

  it("marca done pelo finish_reason", () => {
    expect(interpretarChat({ choices: [{ delta: {}, finish_reason: "stop" }] }).done).toBe(true);
  });

  it("devolve o erro informado pelo backend", () => {
    expect(interpretarChat({ error: "modelo inexistente" }).erro).toBe("modelo inexistente");
  });
});

describe("interpretarLinha", () => {
  it("ignora linhas vazias e comentarios", () => {
    expect(interpretarLinha("")).toBeNull();
    expect(interpretarLinha(": keep-alive")).toBeNull();
  });

  it("ignora o terminador [DONE] e eventos SSE", () => {
    expect(interpretarLinha("data: [DONE]")).toBeNull();
    expect(interpretarLinha("event: ping")).toBeNull();
  });

  it("interpreta uma linha data: com JSON", () => {
    const evt = interpretarLinha('data: {"choices":[{"delta":{"content":"oi"}}]}');
    expect(evt?.texto).toBe("oi");
  });
});
