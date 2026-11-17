import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type http from "node:http";
import { createServer } from "../src/server";
import type { ServerConfig } from "../src/server";
import type { ItemCena, MudancaCena, ReferenciaCena } from "../src/domain/cena";
import type { SessaoMonitoramento } from "../src/domain";

/**
 * Rotas de referencia do ambiente e mudancas (Fase 3).
 * O servidor so usa o relogio quando o chamador omite o instante; aqui todos
 * os instantes sao enviados no corpo.
 */
const BASE = 1_700_000_000_000;

let tmpDir: string;
const servidores: http.Server[] = [];

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "neuro-server-cena-"));
});

afterEach(async () => {
  await Promise.all(
    servidores.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve()))
    )
  );
  await rm(tmpDir, { recursive: true, force: true });
});

async function subirServidor(config: Partial<ServerConfig> = {}): Promise<string> {
  const logFile = path.join(tmpDir, "visao.jsonl");
  const server = createServer({
    logFile,
    publicDir: tmpDir,
    cenaReferenciasFile: path.join(tmpDir, "cena-referencias.jsonl"),
    cenaMudancasFile: path.join(tmpDir, "cena-mudancas.jsonl"),
    ...config,
  });
  servidores.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

async function postJson(
  base: string,
  rota: string,
  corpo: unknown
): Promise<{ status: number; dados: Record<string, unknown> }> {
  const resposta = await fetch(`${base}${rota}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  return { status: resposta.status, dados: (await resposta.json()) as Record<string, unknown> };
}

async function getJson(
  base: string,
  rota: string
): Promise<{ status: number; dados: Record<string, unknown> }> {
  const resposta = await fetch(`${base}${rota}`);
  return { status: resposta.status, dados: (await resposta.json()) as Record<string, unknown> };
}

async function criarSessao(base: string): Promise<SessaoMonitoramento> {
  const resposta = await postJson(base, "/api/monitoramento/sessoes", {
    ambiente: "sala",
    agoraMs: BASE,
  });
  expect(resposta.status).toBe(200);
  return resposta.dados.sessao as SessaoMonitoramento;
}

function item(sobres: Partial<ItemCena> = {}): ItemCena {
  return {
    objetoId: "cadeira-1",
    rotulo: "cadeira",
    caixa: { xmin: 0.2, ymin: 0.2, xmax: 0.4, ymax: 0.4 },
    confirmacao: "confirmado",
    confianca: 0.9,
    observadoEmMs: BASE,
    ...sobres,
  };
}

function rota(sessaoId: string, acao: string): string {
  return `/api/monitoramento/sessoes/${sessaoId}/cena/${acao}`;
}

describe("POST/GET /api/monitoramento/sessoes/:id/cena/referencia", () => {
  it("consolida e devolve o inventario inicial", async () => {
    const base = await subirServidor();
    const sessao = await criarSessao(base);

    expect((await getJson(base, rota(sessao.sessaoId, "referencia"))).dados.referencia).toBeNull();

    const resposta = await postJson(base, rota(sessao.sessaoId, "referencia"), {
      itens: [
        item(),
        item({ objetoId: "mesa-1", rotulo: "mesa", caixa: { xmin: 0.5, ymin: 0.5, xmax: 0.7, ymax: 0.7 } }),
      ],
      criadaEmMs: BASE,
      quadros: 4,
    });
    expect(resposta.status).toBe(200);
    const referencia = resposta.dados.referencia as ReferenciaCena;
    expect(referencia).toMatchObject({ sessaoId: sessao.sessaoId, criadaEmMs: BASE, quadros: 4 });
    expect(referencia.itens.map((i) => i.rotulo)).toEqual(["cadeira", "mesa"]);

    const lida = await getJson(base, rota(sessao.sessaoId, "referencia"));
    expect(lida.status).toBe(200);
    expect(lida.dados.referencia).toEqual(referencia);
  });

  it("recusa sessao desconhecida e payload invalido", async () => {
    const base = await subirServidor();
    const sessao = await criarSessao(base);

    expect(
      (await postJson(base, rota("sessao-inexistente", "referencia"), { itens: [] })).status
    ).toBe(404);
    expect((await postJson(base, rota(sessao.sessaoId, "referencia"), {})).status).toBe(400);
    expect(
      (await postJson(base, rota(sessao.sessaoId, "referencia"), { itens: [item({ confianca: 2 })] })).status
    ).toBe(400);
    expect(
      (await postJson(base, rota(sessao.sessaoId, "referencia"), {
        itens: [],
        criadaEmMs: "invalido",
      })).status
    ).toBe(400);
    expect(
      (await postJson(base, rota(sessao.sessaoId, "referencia"), { itens: [], quadros: 0 })).status
    ).toBe(400);
  });
});

describe("POST /api/monitoramento/sessoes/:id/cena/comparar", () => {
  it("exige referencia, detecta mudanca e deduplica repeticoes", async () => {
    const base = await subirServidor();
    const sessao = await criarSessao(base);
    const comparar = (itens: ItemCena[], agoraMs: number) =>
      postJson(base, rota(sessao.sessaoId, "comparar"), { itens, agoraMs });

    const semReferencia = await comparar([item()], BASE + 10);
    expect(semReferencia.status).toBe(409);

    await postJson(base, rota(sessao.sessaoId, "referencia"), { itens: [item()], criadaEmMs: BASE });
    const atual = [
      item(),
      item({ objetoId: "novo", rotulo: "mochila", confianca: 0.9, caixa: { xmin: 0.6, ymin: 0.6, xmax: 0.8, ymax: 0.8 } }),
    ];

    const primeira = await comparar(atual, BASE + 100);
    expect(primeira.status).toBe(200);
    expect((primeira.dados.mudancas as MudancaCena[]).map((m) => m.tipo)).toEqual([
      "objeto_adicionado",
    ]);
    expect((primeira.dados.novas as MudancaCena[])).toHaveLength(1);

    const repetida = await comparar(atual, BASE + 5000);
    expect(repetida.status).toBe(200);
    expect((repetida.dados.mudancas as MudancaCena[])).toHaveLength(1);
    expect((repetida.dados.novas as MudancaCena[])).toEqual([]);
    expect((repetida.dados.mudancas as MudancaCena[])[0].mudancaId).toBe(
      (primeira.dados.mudancas as MudancaCena[])[0].mudancaId
    );

    const linha = await getJson(base, `${rota(sessao.sessaoId, "mudancas")}?limit=10`);
    expect(linha.status).toBe(200);
    expect(linha.dados.total).toBe(1);
    expect(linha.dados.mudancas).toEqual(primeira.dados.mudancas);
  });

  it("separa ausencia explicita de silencio e valida opcoes", async () => {
    const base = await subirServidor();
    const sessao = await criarSessao(base);
    await postJson(base, rota(sessao.sessaoId, "referencia"), { itens: [item()], criadaEmMs: BASE });

    const silencio = await postJson(base, rota(sessao.sessaoId, "comparar"), {
      itens: [],
      agoraMs: BASE + 10,
    });
    expect(silencio.dados.mudancas).toEqual([]);

    const ausencia = await postJson(base, rota(sessao.sessaoId, "comparar"), {
      itens: [item({ confirmacao: "nao_observado", confianca: 1 })],
      agoraMs: BASE + 20,
    });
    expect(ausencia.dados.mudancas).toMatchObject([
      { tipo: "objeto_removido", observado: false, confianca: 0.55 },
    ]);

    const invalida = await postJson(base, rota(sessao.sessaoId, "comparar"), {
      itens: [item()],
      agoraMs: BASE + 30,
      iouMinimo: 2,
    });
    expect(invalida.status).toBe(400);
    expect(
      (await postJson(base, rota(sessao.sessaoId, "comparar"), { itens: [], agoraMs: "xx" })).status
    ).toBe(400);
    expect((await postJson(base, rota("inexistente", "comparar"), { itens: [] })).status).toBe(404);
  });

  it("devolve 405 para metodo nao suportado", async () => {
    const base = await subirServidor();
    const sessao = await criarSessao(base);
    const resposta = await fetch(`${base}${rota(sessao.sessaoId, "comparar")}`, { method: "PUT" });
    expect(resposta.status).toBe(405);
  });
});
