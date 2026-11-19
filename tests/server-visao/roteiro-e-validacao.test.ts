import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createServer } from "../../src/server";
import { montarPromptRoteiro } from "../../src/visao";
import { realFetch, registrarAmbienteTeste, tmpDir } from "../helpers/server-test-setup";

registrarAmbienteTeste();

describe("POST /api/visao - roteiro e validacao", () => {
  it("POST /api/visao recusa motivo invalido", async () => {
    const logFile = path.join(tmpDir, "visao.jsonl");
    const server = createServer({
      logFile,
      publicDir: tmpDir,
      backendUrl: "http://localhost:1234",
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/visao`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imagem: "data:image/jpeg;base64,QkxPQ", motivo: "sei-la" }),
      });
      expect(res.status).toBe(400);
    } finally {
      server.close();
    }
  });

  it("POST /api/visao no modo roteiro grava a base e colapsa repeticoes nos deltas", async () => {
    const corpos: Record<string, unknown>[] = [];
    const respostas = ["Pessoa de pe.", "A. B. A. B. A. B.", "INALTERADO."];
    let chamada = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (!url.includes("/v1/chat/completions")) return realFetch(input, init);
        const corpo = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
        corpos.push(corpo);
        const texto = respostas[Math.min(chamada, respostas.length - 1)];
        chamada += 1;
        const sse =
          [
            `data: ${JSON.stringify({
              model: "qwen2.5-vl-3b-instruct",
              choices: [{ delta: { content: texto }, finish_reason: "stop" }],
              usage: { completion_tokens: 12 },
            })}`,
            "data: [DONE]",
          ].join("\n") + "\n";
        return { ok: true, body: new Response(sse).body };
      })
    );

    const logFile = path.join(tmpDir, "visao.jsonl");
    const server = createServer({ logFile, publicDir: tmpDir, backendUrl: "http://localhost:1234" });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    const post = (payload: Record<string, unknown>): Promise<Response> =>
      fetch(`http://127.0.0.1:${port}/api/visao`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

    const textoDoCorpo = (corpo: Record<string, unknown>): string => {
      const conteudo = (corpo.messages as { content: unknown }[])[0]?.content;
      if (Array.isArray(conteudo)) return (conteudo[0] as { text?: string }).text ?? "";
      return typeof conteudo === "string" ? conteudo : "";
    };

    try {
      const resBase = await post({ imagem: "QkxPQ", modo: "roteiro", base: true, roteiro: "" });
      expect(resBase.status).toBe(200);
      const eventosBase = (await resBase.text()).trim().split("\n").map((l) => JSON.parse(l));
      const doneBase = eventosBase.find((e) => e.type === "done");
      expect(doneBase.descricao).toBe("Pessoa de pe.");
      expect(doneBase.tipo).toBe("roteiro");
      expect(doneBase.papel).toBe("base");
      expect(textoDoCorpo(corpos[0])).toBe(montarPromptRoteiro(true));
      expect(corpos[0]).not.toHaveProperty("max_tokens");

      const resDelta = await post({ imagem: "QkxPQ", modo: "roteiro", base: false, roteiro: "Pessoa de pe." });
      expect(resDelta.status).toBe(200);
      const doneDelta = (await resDelta.text()).trim().split("\n").map((l) => JSON.parse(l)).find((e) => e.type === "done");
      expect(doneDelta.descricao).toBe("A. B.");
      expect(doneDelta.tipo).toBe("roteiro");
      expect(doneDelta.papel).toBe("delta");
      expect(textoDoCorpo(corpos[1])).toBe(montarPromptRoteiro(false));
      expect(corpos[1]).not.toHaveProperty("max_tokens");

      const resInalterado = await post({
        imagem: "QkxPQ",
        modo: "roteiro",
        base: false,
        roteiro: "Pessoa de pe.",
      });
      const doneInalterado = (await resInalterado.text())
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l))
        .find((e) => e.type === "done");
      expect(doneInalterado.semMudanca).toBe(true);
      expect(doneInalterado.tipo).toBe("roteiro");
      expect(doneInalterado.papel).toBe("delta");

      const linhas = (await readFile(logFile, "utf8")).trim().split("\n");
      expect(linhas).toHaveLength(2);
      expect(JSON.parse(linhas[0])).toMatchObject({ tipo: "roteiro", papel: "base", resumo: "Pessoa de pe." });
      expect(JSON.parse(linhas[1])).toMatchObject({ tipo: "roteiro", papel: "delta", resumo: "A. B." });
    } finally {
      server.close();
    }
  });

  it("POST /api/visao sem imagem retorna 400", async () => {
    const server = createServer({ publicDir: tmpDir });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/visao`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    } finally {
      server.close();
    }
  });
});
