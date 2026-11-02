import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  agregarVisoes,
  chamarGerar,
  inferenciasPorMinuto,
  montarAmbiente,
  montarPromptVisao,
  resolverImagens,
  segundosDeGeracao,
} from "../../scripts/benchmark.mjs";

describe("benchmark de visao", () => {
  it("pede analise profunda tambem para prompts customizados", () => {
    const prompt = montarPromptVisao("Descreva a imagem.");
    expect(prompt).toContain("Descreva a imagem.");
    expect(prompt).toContain("Analise profundamente a imagem inteira");
  });

  it("nao envia um teto de tokens de saida ao backend", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "Resposta" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    try {
      await chamarGerar("http://localhost:1234", "", "modelo-teste", {
        prompt: montarPromptVisao(),
        base64: "aW1hZ2Vt",
        stream: false,
        timeoutMs: 1000,
      });

      const [, init] = fetch.mock.calls[0];
      const body = JSON.parse(String(init.body));
      expect(body).not.toHaveProperty("max_tokens");
      expect(body.messages[0].content[0].text).toContain("Analise profundamente a imagem inteira");
    } finally {
      fetch.mockRestore();
    }
  });

  it("omite imagens marcadas NSFW durante a descoberta automatica", async () => {
    const diretorio = await mkdtemp(path.join(os.tmpdir(), "neuro-bench-"));
    try {
      await writeFile(path.join(diretorio, "cena.png"), "safe");
      await writeFile(path.join(diretorio, "nsfw foto.png"), "sensitive");

      const imagens = await resolverImagens([], [diretorio]);

      expect(imagens.map((imagem) => imagem.nome)).toEqual(["cena.png"]);
    } finally {
      await rm(diretorio, { recursive: true, force: true });
    }
  });
});

describe("segundosDeGeracao", () => {
  it("mede do primeiro token gerado ate o fim", () => {
    expect(segundosDeGeracao({ primeiroDeltaMs: 1000, primeiroMs: 1200, totalMs: 3000 })).toBe(2);
  });

  it("cai para o tempo total quando tudo chega no ultimo chunk", () => {
    // delta < 20 ms nao separa prefill de geracao: usa o total
    expect(segundosDeGeracao({ primeiroDeltaMs: 2999, primeiroMs: 3000, totalMs: 3000 })).toBe(3);
  });

  it("usa o primeiro conteudo quando nao ha primeiro delta", () => {
    expect(segundosDeGeracao({ primeiroMs: 500, totalMs: 2500 })).toBe(2);
  });
});

describe("inferenciasPorMinuto", () => {
  it("respeita o intervalo minimo quando ele domina", () => {
    // total 2000 ms -> intervalo ceil(3000/1000)=3s -> espera 3000 ms -> 20/min
    expect(inferenciasPorMinuto(2000, 3)).toBe(20);
  });

  it("usa total + 500 ms quando maior que o intervalo", () => {
    expect(inferenciasPorMinuto(5000, 1)).toBeCloseTo(60000 / 5500, 1);
  });
});

describe("agregarVisoes", () => {
  it("faz a mediana entre imagens e recalcula o intervalo", () => {
    const r = agregarVisoes([
      { geracaoTokS: 10, prefillTokS: 100, primeiroMs: 1000, totalMs: 2000, tokens: 5, textoChars: 20 },
      { geracaoTokS: 20, prefillTokS: 200, primeiroMs: 3000, totalMs: 4000, tokens: 15, textoChars: 40 },
    ]);
    expect(r.geracaoTokS).toBe(15);
    expect(r.totalMs).toBe(3000);
    expect(r.intervaloMinSeg).toBe(5);
    expect(r.imagens).toBe(2);
  });

  it("ignora resultados sem visao ou sem resposta", () => {
    const r = agregarVisoes([
      { semVisao: true, geracaoTokS: 0 },
      { geracaoTokS: 12, prefillTokS: 120, primeiroMs: 800, totalMs: 1600, tokens: 8, textoChars: 30 },
    ]);
    expect(r.geracaoTokS).toBe(12);
    expect(r.imagens).toBe(1);
  });

  it("soma tentativas e respostas com conteudo entre as imagens", () => {
    const r = agregarVisoes([
      { semResposta: true, geracaoTokS: 0, tentativas: 3, comConteudo: 0 },
      { geracaoTokS: 10, tentativas: 3, comConteudo: 1 },
    ]);
    expect(r.imagens).toBe(1);
    expect(r.tentativas).toBe(6);
    expect(r.comConteudo).toBe(1);
  });

  it("lida com lista vazia", () => {
    expect(agregarVisoes([])).toEqual({});
  });
});

describe("montarAmbiente", () => {
  it("registra hardware e versao do Node", () => {
    const ambiente = montarAmbiente();
    expect(ambiente.node).toMatch(/^v\d+/);
    expect(ambiente.nucleosLogicos).toBeGreaterThan(0);
    expect(typeof ambiente.cpu).toBe("string");
    expect(ambiente.memoriaTotalBytes).toBeGreaterThan(0);
  });
});
