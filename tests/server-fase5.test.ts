import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type http from "node:http";
import { createServer } from "../src/server";
import { paramsDeEventosTemporais } from "../public/api/eventos";
import type { EventoTemporalComVideo } from "../src";

const BASE = 1_700_000_000_000;
const iso = (ms: number) => new Date(ms).toISOString();

let tmpDir: string;
const servidores: http.Server[] = [];

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "neuro-server-fase5-"));
});

afterEach(async () => {
  await Promise.all(
    servidores.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve()))
    )
  );
  await rm(tmpDir, { recursive: true, force: true });
});

async function subirServidor(): Promise<{ base: string; arquivo: string }> {
  const arquivo = path.join(tmpDir, "eventos-temporais.jsonl");
  const server = createServer({
    logFile: path.join(tmpDir, "visao.jsonl"),
    eventosTemporaisFile: arquivo,
    publicDir: tmpDir,
  });
  servidores.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, arquivo };
}

async function postJson(base: string, rota: string, corpo: unknown) {
  const resposta = await fetch(`${base}${rota}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  return { status: resposta.status, corpo: (await resposta.json()) as Record<string, unknown> };
}

async function getJson(base: string, rota: string) {
  const resposta = await fetch(`${base}${rota}`);
  return (await resposta.json()) as Record<string, unknown>;
}

function evento(id: string, extra: Record<string, unknown> = {}) {
  return {
    eventoId: id,
    sessionId: "s1",
    tipo: "interacao_objeto",
    inicioEm: iso(BASE + 100),
    fimEm: iso(BASE + 500),
    descricao: `_evento ${id}_`,
    estado: "confirmado",
    origens: ["maos"],
    frameIds: ["f1"],
    idempotencyKey: `chave-${id}`,
    ...extra,
  };
}

describe("Fase 5 — consulta por pessoa e ação", () => {
  it("filtra pessoa temporária e ação sem confundir com entidade de pose", async () => {
    const { base } = await subirServidor();
    await postJson(base, "/api/eventos-temporais", evento("e1", {
      pessoaEntidadeId: "pessoa-1",
      entidadeId: "obj-1",
      naturezaInteracao: "manipulacao",
      transicaoPosse: "pego",
    }));
    await postJson(base, "/api/eventos-temporais", evento("e2", {
      pessoaEntidadeId: "pessoa-2",
      entidadeId: "obj-1",
      naturezaInteracao: "proximidade",
    }));

    const ids = async (rota: string) =>
      ((await getJson(base, rota)).eventos as EventoTemporalComVideo[]).map((e) => e.eventoId);
    expect(await ids("/api/eventos-temporais?pessoa=pessoa-1")).toEqual(["e1"]);
    expect(await ids("/api/eventos-temporais?acao=pego")).toEqual(["e1"]);
    expect(await ids("/api/eventos-temporais?acao=manipulacao")).toEqual(["e1"]);
    expect(await ids("/api/eventos-temporais?acao=proximidade")).toEqual(["e2"]);
    expect(await ids("/api/eventos-temporais?acao=interacao_objeto")).toEqual(["e2", "e1"]);
    expect(await ids("/api/eventos-temporais?acao=contato")).toEqual([]);
    expect(await ids("/api/eventos-temporais?entidadeId=obj-1&acao=pego")).toEqual(["e1"]);
  });

  it("reusa os mesmos parâmetros no cliente", () => {
    const params = paramsDeEventosTemporais(
      { pessoaEntidadeId: "pessoa-1", acoes: ["pego"], objetos: ["garrafa"] },
      25
    );
    expect(params.get("limit")).toBe("25");
    expect(params.get("pessoa")).toBe("pessoa-1");
    expect(params.get("acao")).toBe("pego");
    expect(params.get("objeto")).toBe("garrafa");
  });
});

describe("Fase 5 — exportação", () => {
  it("exporta JSONL com metadados, filtros e eventos do schema canônico", async () => {
    const { base } = await subirServidor();
    await postJson(base, "/api/eventos-temporais", evento("e1", {
      rotuloObjeto: "garrafa",
      naturezaInteracao: "manipulacao",
      transicaoPosse: "pego",
    }));
    await postJson(base, "/api/eventos-temporais", evento("e2", {
      sessionId: "s2",
      rotuloObjeto: "copo",
      naturezaInteracao: "proximidade",
    }));

    const resposta = await fetch(
      `${base}/api/eventos/exportar?formato=jsonl&sessionId=s1&acao=pego`
    );
    expect(resposta.status).toBe(200);
    expect(resposta.headers.get("content-type")).toContain("application/x-ndjson");
    expect(resposta.headers.get("content-disposition")).toContain("neuro-vision-eventos-");
    const linhas = (await resposta.text()).trim().split("\n").map((linha) => JSON.parse(linha));
    expect(linhas[0]).toMatchObject({
      registro: "metadados",
      versao: 1,
      sessaoId: "s1",
      total: 1,
      filtros: { sessionId: "s1", acao: "pego" },
    });
    expect(linhas[1]).toMatchObject({
      registro: "evento",
      fluxo: "temporal",
      eventoId: "e1",
      naturezaInteracao: "manipulacao",
    });
  });

  it("exporta CSV com cabeçalho estável", async () => {
    const { base } = await subirServidor();
    await postJson(base, "/api/eventos", {
      id: "v1",
      timestamp: iso(BASE),
      tipo: "aparicao",
      descricao: "pessoa entrou",
      origem: "visao",
      sessaoId: "s1",
    });
    const resposta = await fetch(`${base}/api/eventos/exportar?formato=csv`);
    expect(resposta.headers.get("content-type")).toContain("text/csv");
    const csv = await resposta.text();
    expect(csv.split("\r\n")[0]).toContain("fluxo,eventoId,sessaoId,tipo");
    expect(csv).toContain("pessoa entrou");
  });
});

describe("Fase 5 — correção auditável", () => {
  it("anexa nova versão, preserva o original e recusa campos inventados", async () => {
    const { base, arquivo } = await subirServidor();
    await postJson(base, "/api/eventos-temporais", evento("e1", {
      rotuloObjeto: "garrafa",
      statusEvidencia: "observado",
    }));

    const corrigido = await postJson(
      base,
      "/api/eventos-temporais/e1/corrigir",
      {
        eventoId: "e1",
        corrigidoPor: "ana",
        motivo: "rótulo conferido",
        alteracoes: { rotuloObjeto: "garrafa térmica" },
      }
    );
    expect(corrigido.status).toBe(200);
    expect(corrigido.corpo).toMatchObject({ ok: true, versao: 1 });
    const versao = corrigido.corpo.evento as Record<string, unknown>;
    expect(versao).toMatchObject({
      rotuloObjeto: "garrafa térmica",
      statusEvidencia: "observado",
      schemaVersion: 1,
      correcao: {
        versao: 1,
        corrigidoPor: "ana",
        motivo: "rótulo conferido",
        valorOriginal: { rotuloObjeto: "garrafa" },
      },
    });

    const atual = await getJson(base, "/api/eventos-temporais");
    expect((atual.eventos as EventoTemporalComVideo[])[0].rotuloObjeto).toBe("garrafa térmica");
    const linhas = (await readFile(arquivo, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    expect(linhas).toHaveLength(2);
    expect(linhas[0].rotuloObjeto).toBe("garrafa");
    expect(linhas[1].rotuloObjeto).toBe("garrafa térmica");

    const invalida = await postJson(base, "/api/eventos-temporais/e1/corrigir", {
      eventoId: "e1",
      corrigidoPor: "ana",
      motivo: "x",
      alteracoes: { statusEvidencia: "observado" },
    });
    expect(invalida.status).toBe(400);
    const inexistente = await postJson(base, "/api/eventos-temporais/nope/corrigir", {
      eventoId: "nope",
      corrigidoPor: "ana",
      motivo: "x",
      alteracoes: { descricao: "outro" },
    });
    expect(inexistente.status).toBe(404);
  });

  it("incrementa a versão e mantém o valor original da versão anterior", async () => {
    const { base } = await subirServidor();
    await postJson(base, "/api/eventos-temporais", evento("e1", { rotuloObjeto: "garrafa" }));
    for (const rotulo of ["copo", "caneca"]) {
      await postJson(base, "/api/eventos-temporais/e1/corrigir", {
        eventoId: "e1",
        corrigidoPor: "ana",
        motivo: `troca para ${rotulo}`,
        alteracoes: { rotuloObjeto: rotulo },
      });
    }
    const atual = (await getJson(base, "/api/eventos-temporais")).eventos as EventoTemporalComVideo[];
    expect(atual[0].rotuloObjeto).toBe("caneca");
    expect(atual[0].correcao).toMatchObject({
      versao: 2,
      valorOriginal: { rotuloObjeto: "copo" },
    });
  });
});

describe("Fase 5 — memória por sessão", () => {
  it("GET /api/contexto?sessionId= devolve somente o histórico daquela sessão", async () => {
    const { base } = await subirServidor();
    await postJson(base, "/api/log", {
      resumo: "da sessao um",
      modelo: "m",
      tipo: "descricao",
      timestamp: iso(BASE),
      sessaoId: "s1",
    });
    await postJson(base, "/api/log", {
      resumo: "da sessao dois",
      modelo: "m",
      tipo: "descricao",
      timestamp: iso(BASE + 1),
      sessaoId: "s2",
    });
    const contexto = await getJson(base, "/api/contexto?sessionId=s2");
    expect(contexto.sessionId).toBe("s2");
    const entradas = contexto.entradas as Array<{ resumo: string }>;
    expect(entradas.map((e) => e.resumo)).toEqual(["da sessao dois"]);
    const global = await getJson(base, "/api/contexto");
    expect((global.entradas as Array<{ resumo: string }>).map((e) => e.resumo)).toHaveLength(2);
  });
});
