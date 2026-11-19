import { afterEach, describe, expect, it, vi } from "vitest";
import {
  gravarEntrada,
  gravarEvento,
  gravarOperacional,
  listarEventos,
  listarEventosTemporais,
  obterContexto,
  saudeSistema,
} from "../../public/api";
import { json } from "../helpers/api-respostas";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api de eventos e operacional", () => {
  it("gravarEvento envia o evento como JSON para /api/eventos", async () => {
    const fetchMock = vi.fn(
      async (_entrada: RequestInfo | URL, _init?: RequestInit) => json({ ok: true })
    );
    vi.stubGlobal("fetch", fetchMock);

    await gravarEvento({
      id: "e1",
      timestamp: "t",
      tipo: "aparicao",
      descricao: "apareceu pessoa",
      origem: "rastreador",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/eventos",
      expect.objectContaining({ method: "POST" })
    );
    const init = fetchMock.mock.calls[0]?.[1];
    const corpo = JSON.parse((init?.body as string) ?? "{}") as { tipo: string };
    expect(corpo.tipo).toBe("aparicao");
  });

  it("gravarEvento sinaliza falha de rede", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );

    await expect(
      gravarEvento({ id: "e1", timestamp: "t", tipo: "movimento", descricao: "x", origem: "rastreador" })
    ).rejects.toThrow("Falha ao gravar evento no servidor");
  });

  it("listarEventos devolve os eventos do servidor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ eventos: [{ id: "e1" }, { id: "e2" }] }))
    );

    expect(await listarEventos(5)).toEqual([{ id: "e1" }, { id: "e2" }]);
  });

  it("listarEventos monta a query com tipos, objeto e janela", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL) => json({ eventos: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await listarEventos(10, {
      tipos: ["aparicao", "desaparecimento"],
      objetoId: "obj-1",
      desde: 1000,
      ate: 2000,
    });

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("/api/eventos?");
    const params = new URLSearchParams(url.slice(url.indexOf("?") + 1));
    expect(params.get("limit")).toBe("10");
    expect(params.get("tipo")).toBe("aparicao,desaparecimento");
    expect(params.get("objetoId")).toBe("obj-1");
    expect(params.get("desde")).toBe("1000");
    expect(params.get("ate")).toBe("2000");
  });

  it("listarEventos sem filtros envia apenas o limite", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL) => json({ eventos: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await listarEventos(7);

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/api/eventos?limit=7");
  });

  it("listarEventosTemporais envia todos os filtros da linha do tempo", async () => {
    const eventos = [{ eventoId: "e1", segmentos: [{ segmentoId: "seg-1", url: "/v/seg-1" }] }];
    const fetchMock = vi.fn(async (_url: RequestInfo | URL) => json({ eventos }));
    vi.stubGlobal("fetch", fetchMock);

    expect(
      await listarEventosTemporais(25, {
        tipos: ["interacao_objeto"],
        estados: ["confirmado", "provavel"],
        entidadeId: "pes-1",
        sessionId: "sess-1",
        objetos: ["garrafa"],
        participantes: ["mao-1", "obj-1"],
        segmentoId: "seg-1",
        desde: 1000,
        ate: "2026-11-18T12:00:00.000Z",
      })
    ).toEqual(eventos);

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("/api/eventos-temporais?");
    const params = new URLSearchParams(url.slice(url.indexOf("?") + 1));
    expect(params.get("limit")).toBe("25");
    expect(params.get("tipo")).toBe("interacao_objeto");
    expect(params.get("estado")).toBe("confirmado,provavel");
    expect(params.get("entidadeId")).toBe("pes-1");
    expect(params.get("sessionId")).toBe("sess-1");
    expect(params.get("objeto")).toBe("garrafa");
    expect(params.get("participante")).toBe("mao-1,obj-1");
    expect(params.get("segmentoId")).toBe("seg-1");
    expect(params.get("desde")).toBe("1000");
    expect(params.get("ate")).toBe("2026-11-18T12:00:00.000Z");
  });

  it("listarEventosTemporais sem filtros envia apenas o limite", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL) => json({ eventos: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await listarEventosTemporais();

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/api/eventos-temporais?limit=100");
  });

  it("listarEventosTemporais transforma falha HTTP e falha de rede em ErroPercepcao", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ ok: false }, 503)));
    await expect(listarEventosTemporais()).rejects.toMatchObject({ origem: "armazenamento" });

    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("rede"))));
    await expect(listarEventosTemporais()).rejects.toMatchObject({ origem: "armazenamento" });
  });

  it("gravarOperacional e best-effort e nao lanca em falha de rede", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );

    await expect(gravarOperacional({ nivel: "erro", mensagem: "falha" })).resolves.toBe(false);
  });

  it("gravarOperacional detecta HTTP nao-OK sem interromper a captura", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ ok: false, erro: "cheio" }, 500)));
    await expect(gravarOperacional({ mensagem: "falha" })).resolves.toBe(false);

    vi.stubGlobal("fetch", vi.fn(async () => json({ ok: true }, 200)));
    await expect(gravarOperacional({ mensagem: "falha" })).resolves.toBe(true);
  });

  it("saudeSistema devolve visao, recursos e monitoramento do /api/health", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          ok: true,
          visao: { online: false, modelos: [], erro: "offline" },
          sistema: {
            cpu: { userMs: 1, systemMs: 0, usoPercentual: 12.5, nucleos: 4 },
            ram: {
              rssBytes: 10,
              heapUsedBytes: 5,
              heapTotalBytes: 8,
              sistemaTotalBytes: 100,
              sistemaLivreBytes: 40,
            },
            gpu: { utilizacaoPercentual: null, motivo: "indisponivel" },
            armazenamento: { arquivos: 0, bytesTotal: 0, bytesPorHora: null },
          },
          monitoramento: { sessaoId: null, estado: null, segmentos: 0, quadros: 0, lacunas: 0 },
        })
      )
    );

    const saude = await saudeSistema();
    expect(saude.sistema?.cpu.usoPercentual).toBe(12.5);
    expect(saude.sistema?.gpu.utilizacaoPercentual).toBeNull();
    expect(saude.monitoramento?.lacunas).toBe(0);
  });

  it("obterContexto normaliza o contexto recuperado", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          ok: true,
          resumo: "Descricoes recentes: x",
          roteiro: ["passo 1"],
          ultimaDescricao: "pessoa na sala",
          entradas: [{ resumo: "pessoa na sala" }],
          eventos: [{ id: "e1" }],
        })
      )
    );

    const contexto = await obterContexto();
    expect(contexto).toMatchObject({
      resumo: "Descricoes recentes: x",
      roteiro: ["passo 1"],
      ultimaDescricao: "pessoa na sala",
    });
    expect(contexto?.entradas).toHaveLength(1);
    expect(contexto?.eventos).toHaveLength(1);
  });

  it("gravarEntrada rejeita quando servidor responde 400", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ erro: "invalido" }, 400)));
    await expect(gravarEntrada({ timestamp: "t", modelo: "m", objetos: [], resumo: "", tipo: "deteccao" })).rejects.toThrow("invalido");
  });

  it("gravarEntrada rejeita quando servidor responde 500", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ erro: "boom" }, 500)));
    await expect(gravarEntrada({ timestamp: "t", modelo: "m", objetos: [], resumo: "", tipo: "deteccao" })).rejects.toThrow("boom");
  });

  it("gravarEvento rejeita quando servidor responde 400", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ erro: "bad" }, 400)));
    await expect(
      gravarEvento({
        id: "e1",
        timestamp: "t",
        tipo: "movimento",
        descricao: "mov",
        origem: "rastreador",
      })
    ).rejects.toThrow("bad");
  });

  it("gravarEvento rejeita quando servidor responde 500", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ erro: "boom" }, 500)));
    await expect(
      gravarEvento({
        id: "e1",
        timestamp: "t",
        tipo: "movimento",
        descricao: "mov",
        origem: "rastreador",
      })
    ).rejects.toThrow("boom");
  });

  it("obterContexto sinaliza falha de rede", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );

    await expect(obterContexto()).rejects.toThrow("Falha ao recuperar o contexto");
  });
});
