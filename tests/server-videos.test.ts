import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type http from "node:http";
import { createServer } from "../src/server";
import type { SessaoMonitoramento, VideoSegment } from "../src/domain";
import type { ServerConfig } from "../src/server";

/** Rotas de bytes de video (Fase 3): upload, leitura, exclusao e retencao. */
const BASE = 1_700_000_000_000;

let tmpDir: string;
const servidores: http.Server[] = [];

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "neuro-server-videos-"));
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
    videosDir: path.join(tmpDir, "videos"),
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

async function postVideo(
  base: string,
  segmentoId: string,
  conteudo: string,
  opcoes: { criadoEmMs?: number; contentType?: string } = {}
): Promise<Response> {
  const params = new URLSearchParams();
  if (opcoes.criadoEmMs !== undefined) params.set("criadoEmMs", String(opcoes.criadoEmMs));
  return fetch(`${base}/api/monitoramento/videos/${segmentoId}?${params.toString()}`, {
    method: "POST",
    headers: { "Content-Type": opcoes.contentType ?? "video/webm" },
    body: new Blob([conteudo]),
  });
}

async function sessaoComSegmentoFechado(
  base: string
): Promise<{ sessao: SessaoMonitoramento; segmento: VideoSegment }> {
  const inicio = await postJson(base, "/api/monitoramento/sessoes", {
    ambiente: "sala",
    agoraMs: BASE,
    duracaoSegmentoMs: 1000,
  });
  const sessao = inicio.dados.sessao as SessaoMonitoramento;
  await postJson(base, "/api/monitoramento/quadros", {
    quadros: [
      { frameId: "f0", capturadoEmMs: BASE },
      { frameId: "f1", capturadoEmMs: BASE + 500 },
    ],
  });
  const fim = await postJson(base, `/api/monitoramento/sessoes/${sessao.sessaoId}/encerrar`, {
    agoraMs: BASE + 600,
  });
  expect(fim.status).toBe(200);
  const segmentos = await getJson(base, `/api/monitoramento/sessoes/${sessao.sessaoId}/segmentos`);
  return {
    sessao,
    segmento: (segmentos.dados.segmentos as VideoSegment[])[0],
  };
}

describe("POST/GET /api/monitoramento/videos/:id", () => {
  it("envia, lista e devolve os bytes do segmento fechado", async () => {
    const base = await subirServidor();
    const { sessao, segmento } = await sessaoComSegmentoFechado(base);

    const upload = await postVideo(base, segmento.segmentoId, "bytes-do-video", {
      criadoEmMs: BASE,
      contentType: "video/webm;codecs=vp9",
    });
    expect(upload.status).toBe(201);
    const dados = (await upload.json()) as { arquivo: Record<string, unknown> };
    expect(dados.arquivo).toMatchObject({
      segmentoId: segmento.segmentoId,
      sessaoId: sessao.sessaoId,
      contentType: "video/webm",
      bytes: 14,
    });

    const lista = await getJson(base, `/api/monitoramento/videos?sessaoId=${sessao.sessaoId}`);
    expect(lista.status).toBe(200);
    expect(lista.dados.total).toBe(1);

    const download = await fetch(`${base}/api/monitoramento/videos/${segmento.segmentoId}`);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("video/webm");
    expect(await download.text()).toBe("bytes-do-video");
  });

  it("recusa segmento desconhecido, segmento aberto e formato invalido", async () => {
    const base = await subirServidor();
    expect((await postVideo(base, "nao-existe", "x")).status).toBe(404);

    const inicio = await postJson(base, "/api/monitoramento/sessoes", {
      ambiente: "sala",
      agoraMs: BASE,
    });
    const sessao = inicio.dados.sessao as SessaoMonitoramento;
    await postJson(base, "/api/monitoramento/quadros", {
      quadros: [{ frameId: "f0", capturadoEmMs: BASE }],
    });
    const vivos = await getJson(base, `/api/monitoramento/sessoes/${sessao.sessaoId}/segmentos`);
    const aberto = (vivos.dados.segmentos as VideoSegment[])[0];

    const recusado = await postVideo(base, aberto.segmentoId, "x");
    expect(recusado.status).toBe(409);
    expect(((await recusado.json()) as { motivo: string }).motivo).toBe("segmento_aberto");

    await postJson(base, `/api/monitoramento/sessoes/${sessao.sessaoId}/encerrar`, {
      agoraMs: BASE + 10,
    });
    expect((await postVideo(base, aberto.segmentoId, "x", { contentType: "text/plain" })).status).toBe(400);
  });

  it("reenvio com o mesmo tamanho e idempotente", async () => {
    const base = await subirServidor();
    const { segmento } = await sessaoComSegmentoFechado(base);
    const primeiro = await postVideo(base, segmento.segmentoId, "abc", { criadoEmMs: BASE });
    const repetido = await postVideo(base, segmento.segmentoId, "xyz", { criadoEmMs: BASE });
    expect(primeiro.status).toBe(201);
    expect(repetido.status).toBe(201);
    const download = await fetch(`${base}/api/monitoramento/videos/${segmento.segmentoId}`);
    expect(await download.text()).toBe("abc");
  });

  it("valida parametros e metodo", async () => {
    const base = await subirServidor();
    const { segmento } = await sessaoComSegmentoFechado(base);
    const invalido = await postVideo(base, segmento.segmentoId, "x", {
      criadoEmMs: Number.NaN,
    });
    expect(invalido.status).toBe(400);

    const metodo = await fetch(`${base}/api/monitoramento/videos/${segmento.segmentoId}`, {
      method: "PUT",
    });
    expect(metodo.status).toBe(405);
    expect((await fetch(`${base}/api/monitoramento/videos/inexistente`)).status).toBe(404);
  });
});

describe("DELETE /api/monitoramento/videos", () => {
  it("apaga um video e todos os de uma sessao", async () => {
    const base = await subirServidor();
    const { sessao, segmento } = await sessaoComSegmentoFechado(base);
    await postVideo(base, segmento.segmentoId, "abc", { criadoEmMs: BASE });

    const um = await fetch(`${base}/api/monitoramento/videos/${segmento.segmentoId}`, {
      method: "DELETE",
    });
    expect(um.status).toBe(200);
    expect((await fetch(`${base}/api/monitoramento/videos/${segmento.segmentoId}`)).status).toBe(404);
    expect((await fetch(`${base}/api/monitoramento/videos/${segmento.segmentoId}`, { method: "DELETE" })).status).toBe(404);

    await postVideo(base, segmento.segmentoId, "abc", { criadoEmMs: BASE });
    const todos = await fetch(`${base}/api/monitoramento/videos?sessaoId=${sessao.sessaoId}`, {
      method: "DELETE",
    });
    expect(todos.status).toBe(200);
    expect(((await todos.json()) as { total: number }).total).toBe(1);
    expect(((await getJson(base, "/api/monitoramento/videos")).dados.total) as number).toBe(0);

    const semSessao = await fetch(`${base}/api/monitoramento/videos`, { method: "DELETE" });
    expect(semSessao.status).toBe(400);
  });
});

describe("POST /api/monitoramento/videos/retencao", () => {
  it("aplica retencao automatica no upload e permite disparo explicito", async () => {
    const expirado = await subirServidor({ videoRetencaoMs: 1000 });
    const antigo = await sessaoComSegmentoFechado(expirado);
    await postVideo(expirado, antigo.segmento.segmentoId, "abc", { criadoEmMs: BASE });
    // criadoEmMs antigo expira na limpeza disparada pelo proprio upload.
    expect(((await getJson(expirado, "/api/monitoramento/videos")).dados.total) as number).toBe(0);

    const controlado = await subirServidor({ videoRetencaoMs: 1000 });
    const recente = await sessaoComSegmentoFechado(controlado);
    const agora = Date.now();
    await postVideo(controlado, recente.segmento.segmentoId, "abc", { criadoEmMs: agora });
    expect(((await getJson(controlado, "/api/monitoramento/videos")).dados.total) as number).toBe(1);

    const resposta = await fetch(
      `${controlado}/api/monitoramento/videos/retencao?agoraMs=${agora + 2000}`,
      { method: "POST" }
    );
    expect(resposta.status).toBe(200);
    expect(((await resposta.json()) as { total: number }).total).toBe(1);
    expect(((await getJson(controlado, "/api/monitoramento/videos")).dados.total) as number).toBe(0);
  });
});
