import { afterEach, describe, expect, it, vi } from "vitest";
import {
  gravarCiclo,
  listarCiclos,
} from "../../public/api";
import type { RegistroCiclo } from "../../src/domain/cycle";
import { json } from "../helpers/api-respostas";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api de ciclos", () => {
  const registro: RegistroCiclo = {
    sessionId: "s1",
    cycleId: "s1-c1",
    iniciadoEm: "2026-10-17T00:00:00.000Z",
    frameIds: ["f1", "f2"],
    observacoes: 2,
    eventosTemporais: 0,
    subsistemasIndisponiveis: [],
    erros: [],
    metricas: { totalMs: 10 },
    cancelado: false,
    registroEm: "2026-10-17T00:00:01.000Z",
  };

  it("gravarCiclo envia o diagnostico como JSON para /api/ciclos", async () => {
    const fetchMock = vi.fn(
      async (_entrada: RequestInfo | URL, _init?: RequestInit) => json({ ok: true })
    );
    vi.stubGlobal("fetch", fetchMock);

    await gravarCiclo(registro);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/ciclos",
      expect.objectContaining({ method: "POST" })
    );
    const init = fetchMock.mock.calls[0]?.[1];
    const corpo = JSON.parse((init?.body as string) ?? "{}") as { cycleId: string; frameIds: string[] };
    expect(corpo.cycleId).toBe("s1-c1");
    expect(corpo.frameIds).toEqual(["f1", "f2"]);
  });

  it("gravarCiclo sinaliza falha de rede", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );

    await expect(gravarCiclo(registro)).rejects.toThrow(
      "Falha ao gravar o diagnostico do ciclo"
    );
  });

  it("gravarCiclo rejeita quando o servidor responde com erro", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ erro: "ciclo invalido" }, 400)));
    await expect(gravarCiclo(registro)).rejects.toThrow("ciclo invalido");
  });

  it("listarCiclos devolve os diagnosticos do servidor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ ciclos: [{ cycleId: "s1-c1" }, { cycleId: "s1-c2" }] }))
    );

    expect((await listarCiclos(5)).map((c) => c.cycleId)).toEqual(["s1-c1", "s1-c2"]);
  });

  it("listarCiclos envia o limite como query", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL) => json({ ciclos: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await listarCiclos(7);

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/api/ciclos?limit=7");
  });

  it("listarCiclos rejeita quando o servidor responde com erro", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ erro: "boom" }, 500)));
    await expect(listarCiclos()).rejects.toThrow("HTTP 500");
  });
});
