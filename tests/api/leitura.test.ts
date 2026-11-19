import { afterEach, describe, expect, it, vi } from "vitest";
import {
  listarEntradas,
  limparHistorico,
  prepararVisao,
  saudeVisao,
} from "../../public/api";
import { json } from "../helpers/api-respostas";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api de leitura", () => {
  it("listarEntradas devolve as entradas do servidor", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ entradas: [{ resumo: "a" }, { resumo: "b" }] })));

    expect(await listarEntradas(10)).toEqual([{ resumo: "a" }, { resumo: "b" }]);
  });

  it("listarEntradas lanca quando a resposta falha", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({}, 500)));

    await expect(listarEntradas()).rejects.toThrow("HTTP 500");
  });

  it("limparHistorico lanca quando a resposta falha", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({}, 500)));

    await expect(limparHistorico()).rejects.toThrow("HTTP 500");
  });

  it("saudeVisao devolve o objeto visao", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ visao: { online: true, modelos: ["m"], carregados: [], erro: "" } }))
    );

    const info = await saudeVisao();
    expect(info?.online).toBe(true);
    expect(info?.modelos).toEqual(["m"]);
  });

  it("prepararVisao usa a mensagem de erro do servidor", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ erro: "Backend: modelo indisponivel" }, 502)));

    await expect(prepararVisao()).rejects.toThrow("Backend: modelo indisponivel");
  });

  it("prepararVisao pede o modelo escolhido quando informado", async () => {
    const fetchMock = vi.fn(async (_entrada: RequestInfo | URL, _init?: RequestInit) =>
      json({ ok: true, carregado: true })
    );
    vi.stubGlobal("fetch", fetchMock);

    await prepararVisao("gemma-4-e2b-uncensored-hauhaucs-aggressive");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/visao/preparar?modelo=gemma-4-e2b-uncensored-hauhaucs-aggressive"
    );
  });
});
