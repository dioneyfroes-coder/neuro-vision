import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type http from "node:http";
import { createServer } from "../src/server";
import type {
  EntradaLogComVideo,
  EventoTemporalComVideo,
  EventoVisualComVideo,
  VideoSegment,
} from "../src";

/**
 * Integracao Fase 5: a consulta da linha do tempo devolve cada evento com os
 * segmentos de video que cobrem seu intervalo. Relogio nunca e lido — sessao,
 * quadros e eventos usam `agoraMs`/`capturadoEmMs`/ISO fixos.
 */
const BASE = 1_700_000_000_000;
const iso = (ms: number) => new Date(ms).toISOString();

let tmpDir: string;
const servidores: http.Server[] = [];

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "neuro-server-eventos-video-"));
});

afterEach(async () => {
  await Promise.all(
    servidores.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve()))
    )
  );
  await rm(tmpDir, { recursive: true, force: true });
});

async function subirServidor(): Promise<string> {
  const server = createServer({
    logFile: path.join(tmpDir, "visao.jsonl"),
    publicDir: tmpDir,
  });
  servidores.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function postJson(base: string, rota: string, corpo: unknown): Promise<Record<string, unknown>> {
  const resposta = await fetch(`${base}${rota}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  return (await resposta.json()) as Record<string, unknown>;
}

async function getJson(base: string, rota: string): Promise<Record<string, unknown>> {
  const resposta = await fetch(`${base}${rota}`);
  return (await resposta.json()) as Record<string, unknown>;
}

async function prepararCena(base: string): Promise<{ segmentos: VideoSegment[]; sessaoId: string }> {
  const inicio = await postJson(base, "/api/monitoramento/sessoes", {
    ambiente: "sala",
    agoraMs: BASE,
    duracaoSegmentoMs: 1_000,
  });
  await postJson(base, "/api/monitoramento/quadros", {
    quadros: [0, 900, 1_000, 1_100].map((offset, i) => ({
      frameId: `f${i}`,
      capturadoEmMs: BASE + offset,
    })),
  });
  const consulta = await getJson(base, "/api/monitoramento/segmentos");
  return {
    segmentos: consulta.segmentos as VideoSegment[],
    sessaoId: String((inicio.sessao as { sessaoId: string }).sessaoId),
  };
}

function evento(
  eventoId: string,
  inicioMs: number,
  fimMs: number,
  extra: Record<string, unknown> = {}
) {
  return {
    eventoId,
    sessionId: "sessao-ciclo",
    tipo: "interacao_objeto",
    inicioEm: iso(inicioMs),
    fimEm: iso(fimMs),
    descricao: `evento ${eventoId}`,
    estado: "confirmado",
    origens: ["maos"],
    frameIds: ["f0"],
    idempotencyKey: `chave-${eventoId}`,
    ...extra,
  };
}

describe("GET /api/eventos-temporais com vinculo de video (Fase 5)", () => {
  it("devolve rotuloObjeto, referencias por segmento e URL reproduzivel", async () => {
    const base = await subirServidor();
    const { segmentos } = await prepararCena(base);
    expect(segmentos.map((s) => s.sequencia)).toEqual([1, 2]);

    await postJson(base, "/api/eventos-temporais", evento("e-interior", BASE + 200, BASE + 500, {
      rotuloObjeto: "garrafa",
      entidadeId: "pes-1",
      participantes: ["mao-1", "obj-1"],
    }));
    await postJson(base, "/api/eventos-temporais", evento("e-fronteira", BASE + 1_000, BASE + 1_200, {
      rotuloObjeto: "copo",
      entidadeId: "pes-1",
      participantes: ["mao-2", "obj-2"],
    }));
    await postJson(base, "/api/eventos-temporais", evento("e-lacuna", BASE + 2_500, BASE + 2_700, {
      rotuloObjeto: "chave",
    }));

    const dados = await getJson(base, "/api/eventos-temporais?limit=10");
    expect(dados.total).toBe(3);
    const eventos = dados.eventos as EventoTemporalComVideo[];
    const porId = new Map(eventos.map((evt) => [evt.eventoId, evt]));

    expect(porId.get("e-interior")).toMatchObject({
      rotuloObjeto: "garrafa",
      entidadeId: "pes-1",
      participantes: ["mao-1", "obj-1"],
    });
    expect(porId.get("e-interior")?.segmentos).toHaveLength(1);
    expect(porId.get("e-interior")?.segmentos[0]).toMatchObject({
      segmentoId: segmentos[0].segmentoId,
      sessaoId: segmentos[0].sessaoId,
      offsetMs: 200,
      ateMs: 500,
      duracaoTrechoMs: 300,
      url: `/api/monitoramento/videos/${encodeURIComponent(segmentos[0].segmentoId)}`,
    });

    const fronteira = porId.get("e-fronteira")?.segmentos ?? [];
    expect(fronteira.map((ref) => ref.segmentoId)).toEqual(
      segmentos.map((s) => s.segmentoId)
    );
    expect(fronteira[0].duracaoTrechoMs).toBe(0);
    // O segundo segmento termina no ultimo quadro real (BASE+1100), nao na
    // duracao alvo: o trecho util e ate la, sem inventar cobertura.
    expect(fronteira[1]).toMatchObject({ offsetMs: 0, ateMs: 100, duracaoTrechoMs: 100 });
    expect(porId.get("e-lacuna")?.segmentos).toEqual([]);
  });

  it("filtra por periodo, pessoa, objeto, tipo, sessao e segmento", async () => {
    const base = await subirServidor();
    const { segmentos, sessaoId } = await prepararCena(base);
    await postJson(base, "/api/eventos-temporais", evento("e-um", BASE + 100, BASE + 200, {
      rotuloObjeto: "garrafa",
      entidadeId: "pes-1",
      participantes: ["mao-1", "obj-1"],
      sessionId: sessaoId,
    }));
    await postJson(base, "/api/eventos-temporais", evento("e-dois", BASE + 1_100, BASE + 1_200, {
      rotuloObjeto: "copo",
      entidadeId: "pes-2",
      participantes: ["mao-2", "obj-2"],
      sessionId: sessaoId,
    }));

    const ids = async (rota: string) =>
      ((await getJson(base, rota)).eventos as EventoTemporalComVideo[]).map((e) => e.eventoId);

    expect(await ids("/api/eventos-temporais?desde=" + iso(BASE + 1_000))).toEqual(["e-dois"]);
    expect(await ids("/api/eventos-temporais?ate=" + iso(BASE + 500))).toEqual(["e-um"]);
    expect(await ids("/api/eventos-temporais?entidadeId=pes-2")).toEqual(["e-dois"]);
    expect(await ids("/api/eventos-temporais?objeto=garrafa")).toEqual(["e-um"]);
    expect(await ids("/api/eventos-temporais?participante=obj-2")).toEqual(["e-dois"]);
    // A memora e append-only: a leitura devolve a atualizacao mais recente primeiro.
    expect(await ids("/api/eventos-temporais?sessionId=" + encodeURIComponent(sessaoId))).toEqual([
      "e-dois",
      "e-um",
    ]);
    expect(
      await ids(`/api/eventos-temporais?segmentoId=${encodeURIComponent(segmentos[1].segmentoId)}`)
    ).toEqual(["e-dois"]);
    expect(await ids("/api/eventos-temporais?objeto=inexistente")).toEqual([]);
  });

  it("vincula tambem segmentos indexados depois do evento e nao inventa video", async () => {
    const base = await subirServidor();
    await postJson(base, "/api/eventos-temporais", evento("e-antigo", BASE + 100, BASE + 200));
    const antes = await getJson(base, "/api/eventos-temporais");
    expect((antes.eventos as EventoTemporalComVideo[])[0].segmentos).toEqual([]);

    await prepararCena(base);
    const depois = await getJson(base, "/api/eventos-temporais");
    expect((depois.eventos as EventoTemporalComVideo[])[0].segmentos).toHaveLength(1);
  });
});

describe("GET /api/logs e /api/eventos com evidencia de video (Fase 5)", () => {
  it("anexa trechos as descricoes usando capturadoEm e, na ausencia, timestamp", async () => {
    const base = await subirServidor();
    const { segmentos } = await prepararCena(base);

    await postJson(base, "/api/log", {
      resumo: "captura com capturadoEm",
      modelo: "modelo-teste",
      tipo: "descricao",
      capturadoEm: iso(BASE + 500),
      timestamp: iso(BASE + 2_500),
      frameIds: ["f-capturado"],
    });
    await postJson(base, "/api/log", {
      resumo: "captura sem capturadoEm",
      modelo: "modelo-teste",
      tipo: "descricao",
      timestamp: iso(BASE + 1_050),
      frameIds: ["f-timestamp"],
    });

    const dados = await getJson(base, "/api/logs?limit=10");
    const entradas = dados.entradas as EntradaLogComVideo[];
    const porResumo = new Map(entradas.map((entrada) => [entrada.resumo, entrada]));

    const comCaptura = porResumo.get("captura com capturadoEm")?.segmentos ?? [];
    expect(comCaptura.map((ref) => ref.segmentoId)).toEqual([segmentos[0].segmentoId]);
    expect(comCaptura[0]).toMatchObject({
      offsetMs: 0,
      ateMs: 1_000,
      duracaoTrechoMs: 1_000,
      url: `/api/monitoramento/videos/${encodeURIComponent(segmentos[0].segmentoId)}`,
    });

    const comTimestamp = porResumo.get("captura sem capturadoEm")?.segmentos ?? [];
    expect(comTimestamp).toHaveLength(1);
    expect(comTimestamp[0]).toMatchObject({
      segmentoId: segmentos[1].segmentoId,
      offsetMs: 0,
      ateMs: 100,
      duracaoTrechoMs: 100,
    });
  });

  it("anexa trecho ao fato visual derivado do indice atual", async () => {
    const base = await subirServidor();
    await postJson(base, "/api/eventos", {
      id: "ev-visual-1",
      timestamp: iso(BASE + 500),
      tipo: "aparicao",
      descricao: "pessoa entrou",
      origem: "visao",
      frameId: "f-visual",
    });

    const antes = await getJson(base, "/api/eventos?limit=10");
    expect((antes.eventos as EventoVisualComVideo[])[0].segmentos).toEqual([]);

    await prepararCena(base);
    const depois = await getJson(base, "/api/eventos?limit=10");
    const [evento] = depois.eventos as EventoVisualComVideo[];
    expect(evento.id).toBe("ev-visual-1");
    expect(evento.segmentos).toHaveLength(1);
    expect(evento.segmentos[0]).toMatchObject({ offsetMs: 0, ateMs: 1_000 });
  });

  it("nao inventa video para descricao em lacuna de gravacao", async () => {
    const base = await subirServidor();
    await prepararCena(base);
    await postJson(base, "/api/log", {
      resumo: "fora da cobertura",
      modelo: "modelo-teste",
      tipo: "descricao",
      capturadoEm: iso(BASE + 2_500),
    });

    const dados = await getJson(base, "/api/logs?limit=10");
    const entrada = (dados.entradas as EntradaLogComVideo[]).find(
      (item) => item.resumo === "fora da cobertura"
    );
    expect(entrada?.segmentos).toEqual([]);
  });
});
