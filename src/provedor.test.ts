import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cabecalhos,
  definirProvedorDetectado,
  detectarProvedor,
  extrairBase64,
  interpretarChat,
  interpretarLinha,
  modoAuto,
  montarRequisicaoChat,
  paraDataUrl,
  provedorConfigurado,
  raizOpenAI,
  resolverBackend,
  urlChat,
  urlDaImagem,
  urlEmMemoria,
  urlModelos,
} from "./provedor";

const VARIAVEIS = [
  "NEURO_PROVIDER",
  "NEURO_BASE_URL",
  "NEURO_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_API_KEY",
  "OLLAMA_HOST",
  "NEURO_IMG_BASE64_CRU",
];

let ambienteAnterior: Record<string, string | undefined> = {};

beforeEach(() => {
  ambienteAnterior = {};
  for (const chave of VARIAVEIS) {
    ambienteAnterior[chave] = process.env[chave];
    delete process.env[chave];
  }
  definirProvedorDetectado(null);
});

afterEach(() => {
  for (const chave of VARIAVEIS) {
    const valor = ambienteAnterior[chave];
    if (valor === undefined) delete process.env[chave];
    else process.env[chave] = valor;
  }
  definirProvedorDetectado(null);
  vi.unstubAllGlobals();
});

describe("provedorConfigurado", () => {
  it("usa Ollama por padrao", () => {
    expect(provedorConfigurado()).toBe("ollama");
    expect(modoAuto()).toBe(true);
  });

  it("mapeia aliases do LM Studio para openai", () => {
    process.env.NEURO_PROVIDER = "lmstudio";
    expect(provedorConfigurado()).toBe("openai");
    expect(modoAuto()).toBe(false);
  });

  it("usa o provedor detectado quando o modo e auto", () => {
    process.env.NEURO_PROVIDER = "auto";
    definirProvedorDetectado("openai");
    expect(provedorConfigurado()).toBe("openai");
  });
});

describe("resolverBackend", () => {
  it("resolve o Ollama com a URL padrao", () => {
    expect(resolverBackend()).toMatchObject({
      id: "ollama",
      baseUrl: "http://localhost:11434",
    });
  });

  it("resolve o OpenAI com a URL padrao do LM Studio", () => {
    expect(resolverBackend({ provedor: "openai" })).toMatchObject({
      id: "openai",
      baseUrl: "http://localhost:1234",
    });
  });

  it("da prioridade a NEURO_BASE_URL sobre os defaults", () => {
    process.env.NEURO_BASE_URL = "http://outro:9999/";
    expect(resolverBackend({ provedor: "openai" }).baseUrl).toBe("http://outro:9999");
  });

  it("le a chave de API do ambiente", () => {
    process.env.NEURO_API_KEY = "secreta";
    expect(resolverBackend({ provedor: "openai" }).apiKey).toBe("secreta");
  });

  it("ignora o provedor explicito quando e auto", () => {
    process.env.NEURO_PROVIDER = "openai";
    expect(resolverBackend({ provedor: "auto" }).id).toBe("openai");
  });
});

describe("raizOpenAI", () => {
  it("separa a versao /v1 da raiz", () => {
    expect(raizOpenAI("http://localhost:1234/v1")).toEqual({
      raiz: "http://localhost:1234",
      versao: "/v1",
    });
  });

  it("assume /v1 quando a URL nao traz versao", () => {
    expect(raizOpenAI("http://localhost:1234")).toEqual({
      raiz: "http://localhost:1234",
      versao: "/v1",
    });
  });
});

describe("URLs por provedor", () => {
  it("monta as URLs nativas do Ollama", () => {
    const backend = resolverBackend({ provedor: "ollama", baseUrl: "http://host:11434" });
    expect(urlChat(backend)).toBe("http://host:11434/api/chat");
    expect(urlModelos(backend)).toBe("http://host:11434/api/tags");
    expect(urlEmMemoria(backend)).toBe("http://host:11434/api/ps");
  });

  it("monta as URLs OpenAI sem duplicar /v1", () => {
    const backend = resolverBackend({ provedor: "openai", baseUrl: "http://host:1234/v1" });
    expect(urlChat(backend)).toBe("http://host:1234/v1/chat/completions");
    expect(urlModelos(backend)).toBe("http://host:1234/v1/models");
    expect(urlEmMemoria(backend)).toBe("http://host:1234/api/v0/models");
  });
});

describe("cabecalhos", () => {
  it("adiciona Authorization quando ha chave", () => {
    const backend = resolverBackend({ provedor: "openai", apiKey: "k" });
    expect(cabecalhos(backend)).toMatchObject({ Authorization: "Bearer k" });
  });

  it("omite Authorization sem chave", () => {
    const backend = resolverBackend({ provedor: "ollama" });
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
  it("monta o corpo nativo do Ollama com imagens e think desligado", () => {
    const backend = resolverBackend({ provedor: "ollama" });
    const { url, body } = montarRequisicaoChat({
      backend,
      modelo: "llama3.2-vision:11b",
      prompt: "descreva",
      imagem: "data:image/jpeg;base64,AAAA",
      stream: true,
      numPredict: 256,
      opcoesOllama: { temperature: 0.2 },
    });
    expect(url).toBe("http://localhost:11434/api/chat");
    const json = JSON.parse(body);
    expect(json).toMatchObject({
      model: "llama3.2-vision:11b",
      stream: true,
      think: false,
      options: { temperature: 0.2, num_predict: 256 },
    });
    expect(json.messages[0].images).toEqual(["AAAA"]);
  });

  it("monta o corpo OpenAI com bloco image_url (data URL)", () => {
    const backend = resolverBackend({ provedor: "openai" });
    const { url, body } = montarRequisicaoChat({
      backend,
      modelo: "llama-3.2-11b-vision",
      prompt: "descreva",
      imagem: "AAAA",
      stream: false,
      numPredict: 128,
    });
    expect(url).toBe("http://localhost:1234/v1/chat/completions");
    const json = JSON.parse(body);
    expect(json.max_tokens).toBe(128);
    expect(json.messages[0].content).toEqual([
      { type: "text", text: "descreva" },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } },
    ]);
  });

  it("pede usage no stream OpenAI", () => {
    const backend = resolverBackend({ provedor: "openai" });
    const { body } = montarRequisicaoChat({
      backend,
      modelo: "m",
      prompt: "p",
      stream: true,
    });
    expect(JSON.parse(body).stream_options).toEqual({ include_usage: true });
  });
});

describe("interpretarChat", () => {
  it("le a resposta nativa do Ollama", () => {
    const backend = resolverBackend({ provedor: "ollama" });
    const evt = interpretarChat(backend, {
      message: { content: "Uma pessoa." },
      model: "qwen3-vl:4b",
      eval_count: 4,
      total_duration: 2_000_000,
      done: true,
    });
    expect(evt).toMatchObject({
      texto: "Uma pessoa.",
      modelo: "qwen3-vl:4b",
      tokens: 4,
      duracaoMs: 2,
      done: true,
    });
  });

  it("sinaliza thinking do Ollama", () => {
    const backend = resolverBackend({ provedor: "ollama" });
    const evt = interpretarChat(backend, { message: { thinking: "hmm" } });
    expect(evt.pensou).toBe(true);
    expect(evt.texto).toBeUndefined();
  });

  it("le um delta OpenAI e o uso", () => {
    const backend = resolverBackend({ provedor: "openai" });
    const evt = interpretarChat(backend, {
      model: "m",
      choices: [{ delta: { content: "Uma" }, finish_reason: null }],
      usage: { completion_tokens: 5 },
    });
    expect(evt).toMatchObject({ texto: "Uma", tokens: 5, done: false });
  });

  it("marca done pelo finish_reason do OpenAI", () => {
    const backend = resolverBackend({ provedor: "openai" });
    const evt = interpretarChat(backend, {
      choices: [{ delta: {}, finish_reason: "stop" }],
    });
    expect(evt.done).toBe(true);
  });

  it("devolve o erro informado pelo backend", () => {
    const backend = resolverBackend({ provedor: "openai" });
    expect(interpretarChat(backend, { error: "modelo inexistente" }).erro).toBe(
      "modelo inexistente"
    );
  });
});

describe("interpretarLinha", () => {
  it("ignora comentarios e linhas vazias do Ollama", () => {
    const backend = resolverBackend({ provedor: "ollama" });
    expect(interpretarLinha(backend, "")).toBeNull();
    expect(interpretarLinha(backend, ": keep-alive")).toBeNull();
  });

  it("ignora o terminador [DONE] do OpenAI", () => {
    const backend = resolverBackend({ provedor: "openai" });
    expect(interpretarLinha(backend, "data: [DONE]")).toBeNull();
    expect(interpretarLinha(backend, "event: ping")).toBeNull();
  });

  it("interpreta uma linha data: do OpenAI", () => {
    const backend = resolverBackend({ provedor: "openai" });
    const evt = interpretarLinha(
      backend,
      'data: {"choices":[{"delta":{"content":"oi"}}]}'
    );
    expect(evt?.texto).toBe("oi");
  });
});

describe("detectarProvedor", () => {
  it("prefere o Ollama quando /api/tags responde", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    await expect(detectarProvedor()).resolves.toBe("ollama");
  });

  it("cai para o OpenAI quando so /v1/models responde", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        return { ok: url.includes("/v1/models") };
      })
    );
    await expect(detectarProvedor()).resolves.toBe("openai");
  });

  it("mantem o Ollama quando nenhum backend responde", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(detectarProvedor()).resolves.toBe("ollama");
  });
});
