import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type http from "node:http";
import { createServer } from "../src/server";
import type { QuadroAtribuido, SessaoMonitoramento, VideoSegment } from "../src/domain";

/**
 * Rotas de monitoramento (Fase 3): sessao, quadros e indice de segmentos.
 *
 * O relogio nunca e lido nos testes: `agoraMs` e `capturadoEmMs` vem no corpo.
 */
const BASE = 1_700_000_000_000;

let tmpDir: string;
const servidores: http.Server[] = [];

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "neuro-server-monitoramento-"));
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
  const logFile = path.join(tmpDir, "visao.jsonl");
  const server = createServer({ logFile, publicDir: tmpDir });
  servidores.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

async function postJson(base: string, rota: string, corpo: unknown): Promise<{
  status: number;
  dados: Record<string, unknown>;
}> {
  const resposta = await fetch(`${base}${rota}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  return { status: resposta.status, dados: (await resposta.json()) as Record<string, unknown> };
}

async function getJson(base: string, rota: string): Promise<{
  status: number;
  dados: Record<string, unknown>;
}> {
  const resposta = await fetch(`${base}${rota}`);
  return { status: resposta.status, dados: (await resposta.json()) as Record<string, unknown> };
}

function quadros(...itens: Array<[string, number]>) {
  return {
    quadros: itens.map(([frameId, offsetMs]) => ({ frameId, capturadoEmMs: BASE + offsetMs })),
  };
}

describe("POST /api/monitoramento/sessoes", () => {
  it("abre a sessao e recusa uma segunda sessao em andamento", async () => {
    const base = await subirServidor();
    const primeira = await postJson(base, "/api/monitoramento/sessoes", {
      ambiente: "sala",
      agoraMs: BASE,
      duracaoSegmentoMs: 1000,
    });
    expect(primeira.status).toBe(200);
    expect(primeira.dados.sessao).toMatchObject({
      ambiente: "sala",
      estado: "ativa",
      duracaoSegmentoMs: 1000,
    });

    const segunda = await postJson(base, "/api/monitoramento/sessoes", {
      ambiente: "garagem",
      agoraMs: BASE + 10,
    });
    expect(segunda.status).toBe(409);
    expect(String(segunda.dados.erro)).toContain("em andamento");
  });

  it("recusa payload sem ambiente ou com parametros invalidos", async () => {
    const base = await subirServidor();
    expect((await postJson(base, "/api/monitoramento/sessoes", {})).status).toBe(400);
    expect(
      (
        await postJson(base, "/api/monitoramento/sessoes", {
          ambiente: "sala",
          duracaoSegmentoMs: 0,
        })
      ).status
    ).toBe(400);
    expect(
      (
        await postJson(base, "/api/monitoramento/sessoes", {
          ambiente: "sala",
          agoraMs: "nao-e-data",
        })
      ).status
    ).toBe(400);
  });
});

describe("POST /api/monitoramento/quadros", () => {
  it("atribui o lote ao segmento e expoe o segmento vivo", async () => {
    const base = await subirServidor();
    const inicio = await postJson(base, "/api/monitoramento/sessoes", {
      ambiente: "sala",
      agoraMs: BASE,
      duracaoSegmentoMs: 1000,
    });
    const sessao = inicio.dados.sessao as SessaoMonitoramento;

    const lote = await postJson(base, "/api/monitoramento/quadros", {
      ...quadros(["f0", 0], ["f1", 900]),
    });
    expect(lote.status).toBe(200);
    const atribuicoes = lote.dados.atribuicoes as QuadroAtribuido[];
    expect(atribuicoes.map((a) => a.sequenciaSegmento)).toEqual([1, 1]);
    expect(atribuicoes.map((a) => a.offsetMs)).toEqual([0, 900]);
    expect(lote.dados.rejeitados).toEqual([]);

    // O segmento em gravacao aparece com os contadores atuais, mesmo que o
    // indice persistido so registre a abertura ate o fechamento.
    const segmentos = await getJson(
      base,
      `/api/monitoramento/sessoes/${sessao.sessaoId}/segmentos`
    );
    expect(segmentos.status).toBe(200);
    expect(segmentos.dados.segmentos).toEqual([
      expect.objectContaining({ sequencia: 1, estado: "gravando", quadros: 2 }),
    ]);
  });

  it("responde 409 quando nao ha sessao iniciada", async () => {
    const base = await subirServidor();
    const lote = await postJson(base, "/api/monitoramento/quadros", {
      ...quadros(["f0", 0]),
    });
    expect(lote.status).toBe(409);
  });

  it("recusa lotes invalidos antes de atribuir qualquer quadro", async () => {
    const base = await subirServidor();
    await postJson(base, "/api/monitoramento/sessoes", { ambiente: "sala", agoraMs: BASE });
    expect((await postJson(base, "/api/monitoramento/quadros", { quadros: [] })).status).toBe(400);
    expect(
      (
        await postJson(base, "/api/monitoramento/quadros", {
          quadros: [{ frameId: "f0", capturadoEmMs: "ontem" }],
        })
      ).status
    ).toBe(400);
    expect(
      (
        await postJson(base, "/api/monitoramento/quadros", {
          quadros: [{ capturadoEmMs: BASE }],
        })
      ).status
    ).toBe(400);

    // Nada foi atribuido: a sessao continua sem segmentos.
    const sessoes = await getJson(base, "/api/monitoramento/sessoes");
    const sessao = (sessoes.dados.sessoes as SessaoMonitoramento[])[0];
    const segmentos = await getJson(
      base,
      `/api/monitoramento/sessoes/${sessao.sessaoId}/segmentos`
    );
    expect(segmentos.dados.segmentos).toEqual([]);
  });
});

describe("comandos de sessao e consultas", () => {
  it("pausa recusa quadros, retomada abre novo segmento e encerramento preserva os dois", async () => {
    const base = await subirServidor();
    const inicio = await postJson(base, "/api/monitoramento/sessoes", {
      ambiente: "sala",
      agoraMs: BASE,
      duracaoSegmentoMs: 60_000,
    });
    const sessao = inicio.dados.sessao as SessaoMonitoramento;
    const rotaSessao = `/api/monitoramento/sessoes/${sessao.sessaoId}`;

    await postJson(base, "/api/monitoramento/quadros", { ...quadros(["f0", 0]) });
    const pausa = await postJson(base, `${rotaSessao}/pausar`, {});
    expect(pausa.status).toBe(200);
    expect(pausa.dados.sessao).toMatchObject({ estado: "pausada" });

    const durantePausa = await postJson(base, "/api/monitoramento/quadros", {
      ...quadros(["f1", 1000]),
    });
    expect(durantePausa.status).toBe(200);
    expect(durantePausa.dados.atribuicoes).toEqual([]);
    expect(durantePausa.dados.rejeitados).toEqual([
      expect.objectContaining({ frameId: "f1", motivo: "sessao_pausada" }),
    ]);

    await postJson(base, `${rotaSessao}/retomar`, {});
    const retomado = await postJson(base, "/api/monitoramento/quadros", {
      ...quadros(["f2", 9000]),
    });
    expect((retomado.dados.atribuicoes as QuadroAtribuido[])[0].sequenciaSegmento).toBe(2);

    const encerrada = await postJson(base, `${rotaSessao}/encerrar`, { agoraMs: BASE + 9500 });
    expect(encerrada.status).toBe(200);
    expect(encerrada.dados.sessao).toMatchObject({ estado: "encerrada" });

    const segmentos = await getJson(base, `${rotaSessao}/segmentos`);
    const lista = segmentos.dados.segmentos as VideoSegment[];
    expect(lista.map((s) => s.motivoFim)).toEqual(["pausa", "sessao_encerrada"]);
    expect(lista.map((s) => s.quadros)).toEqual([1, 1]);

    // Consulta por intervalo usa extremos inclusivos.
    const noPonto = await getJson(
      base,
      `/api/monitoramento/segmentos?inicio=${BASE}&fim=${BASE}`
    );
    expect((noPonto.dados.segmentos as VideoSegment[]).map((s) => s.sequencia)).toEqual([1]);
  });

  it("responde 409 para sessao divergente e 405 para metodo nao suportado", async () => {
    const base = await subirServidor();
    await postJson(base, "/api/monitoramento/sessoes", { ambiente: "sala", agoraMs: BASE });

    expect(
      (await postJson(base, "/api/monitoramento/sessoes/outra-sessao/pausar", {})).status
    ).toBe(409);

    const metodo = await fetch(`${base}/api/monitoramento/sessoes`, { method: "DELETE" });
    expect(metodo.status).toBe(405);
  });

  it("valida os filtros de intervalo", async () => {
    const base = await subirServidor();
    expect((await getJson(base, "/api/monitoramento/segmentos?inicio=abc")).status).toBe(400);
    expect(
      (await getJson(base, "/api/monitoramento/segmentos?inicio=200&fim=100")).status
    ).toBe(400);
    const vazio = await getJson(base, "/api/monitoramento/segmentos");
    expect(vazio.status).toBe(200);
    expect(vazio.dados.segmentos).toEqual([]);
  });

  it("reconstroi sessoes e segmentos do indice depois de reiniciar o servidor", async () => {
    const base = await subirServidor();
    const inicio = await postJson(base, "/api/monitoramento/sessoes", {
      ambiente: "quintal",
      agoraMs: BASE,
      duracaoSegmentoMs: 1000,
    });
    const sessao = inicio.dados.sessao as SessaoMonitoramento;
    await postJson(base, "/api/monitoramento/quadros", {
      ...quadros(["f0", 0], ["f1", 900], ["f2", 1000]),
    });
    await postJson(base, `/api/monitoramento/sessoes/${sessao.sessaoId}/encerrar`, {
      agoraMs: BASE + 1100,
    });

    // Fecha apenas o primeiro servidor; os arquivos continuam em tmpDir.
    const primeiro = servidores.pop();
    if (primeiro) await new Promise<void>((resolve) => primeiro.close(() => resolve()));
    const reiniciado = await subirServidor();

    const sessoes = await getJson(reiniciado, "/api/monitoramento/sessoes");
    expect(sessoes.dados.sessoes).toEqual([
      expect.objectContaining({
        sessaoId: sessao.sessaoId,
        ambiente: "quintal",
        estado: "encerrada",
      }),
    ]);

    const segmentos = await getJson(
      reiniciado,
      `/api/monitoramento/segmentos?inicio=${BASE}&fim=${BASE + 5000}`
    );
    const lista = segmentos.dados.segmentos as VideoSegment[];
    expect(lista.map((s) => s.sequencia)).toEqual([1, 2]);
    expect(lista.map((s) => s.estado)).toEqual(["fechado", "fechado"]);
    expect(lista[1]).toMatchObject({ inicioMs: BASE + 1000, motivoFim: "sessao_encerrada" });
  });
});
