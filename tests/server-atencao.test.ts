import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type http from "node:http";
import { createServer } from "../src/server";
import type { ServerConfig } from "../src/server";
import type { SessaoMonitoramento } from "../src/domain";

/** Rotas aditivas da telemetria de atenção (Fase 3). */
const BASE = 1_700_000_000_000;

let tmpDir: string;
const servidores: http.Server[] = [];

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "neuro-server-atencao-"));
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
    atencaoFile: path.join(tmpDir, "atencao-seguranca.jsonl"),
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

describe("POST/GET /api/monitoramento/seguranca/atencao", () => {
  it("valida, persiste e filtra telemetria por sessão", async () => {
    const base = await subirServidor();
    const sessao = await criarSessao(base);
    const rota = "/api/monitoramento/seguranca/atencao";

    const invalido = await postJson(base, rota, {
      sessaoId: sessao.sessaoId,
      tipo: "estado",
      registradoEmMs: BASE,
      estado: "inexistente",
    });
    expect(invalido.status).toBe(400);

    const registrado = await postJson(base, rota, {
      sessaoId: sessao.sessaoId,
      tipo: "estado",
      registradoEmMs: BASE,
      estado: "atencao",
      motivo: "presenca",
      cadencia: { deteccaoMs: 2_000 },
    });
    expect(registrado.status).toBe(200);
    expect(registrado.dados.registro).toMatchObject({ estado: "atencao", motivo: "presenca" });

    const listado = await getJson(
      base,
      `${rota}?sessaoId=${encodeURIComponent(sessao.sessaoId)}&limit=10`
    );
    expect(listado.status).toBe(200);
    expect(listado.dados.total).toBe(1);

    const outra = await getJson(base, `${rota}?sessaoId=desconhecida`);
    expect(outra.dados.total).toBe(0);
  });

  it("recusa sessão desconhecida sem gravar registro", async () => {
    const base = await subirServidor();
    const resposta = await postJson(base, "/api/monitoramento/seguranca/atencao", {
      sessaoId: "inexistente",
      tipo: "estado",
      registradoEmMs: BASE,
      estado: "passivo",
    });
    expect(resposta.status).toBe(404);
    const listado = await getJson(base, "/api/monitoramento/seguranca/atencao");
    expect(listado.dados.total).toBe(0);
  });
});
