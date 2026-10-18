import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { ObservacaoFrame } from "../src/domain/observation";
import { criarRegistroCiclo } from "../src/domain/cycle";
import type { ResultadoCiclo } from "../src/domain/cycle";
import type { EntradaLog, EventoVisual } from "../src/types";
import {
  gravarObservacao,
  lerObservacoes,
  limparObservacoes,
} from "../src/persistence/repositorio-observacoes";
import {
  eventoJaRegistrado,
  gravarEvento,
  lerEventos,
  limparEventos,
  marcarEventoRegistrado,
} from "../src/persistence/repositorio-eventos";
import {
  gravarOperacional,
  lerOperacional,
} from "../src/persistence/repositorio-operacional";
import { gravarCiclo, lerCiclos, limparCiclos } from "../src/persistence/repositorio-ciclos";
import { createServer } from "../src/server";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "neuro-persistencia-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function entrada(resumo: string): EntradaLog {
  return {
    timestamp: "2026-10-17T12:00:00.000Z",
    modelo: "m",
    objetos: [],
    resumo,
    tipo: "deteccao",
  };
}

function evento(descricao: string): EventoVisual {
  return {
    id: `evt-${descricao}`,
    timestamp: "2026-10-17T12:00:00.000Z",
    tipo: "resumo",
    descricao,
    origem: "visao",
  };
}

function observacao(
  frameId: string,
  poseIndisponivel = false
): ObservacaoFrame {
  return {
    sessionId: "sessao-1",
    cycleId: "sessao-1-c1",
    frameId,
    capturadoEm: "2026-10-17T12:00:00.000Z",
    capturadoEmMs: 1000,
    imagem: "data:image/jpeg;base64,QQ==",
    deteccoes: { deteccoes: [] },
    pose: poseIndisponivel
      ? { indisponivel: true, subsistema: "pose", motivo: "sem modelo" }
      : { pessoas: [] },
    maos: { maos: [] },
  };
}

function resultadoCiclo(
  observacoes: ObservacaoFrame[],
  extras: Partial<ResultadoCiclo> = {}
): ResultadoCiclo {
  return {
    pacote: {
      sessionId: "sessao-1",
      cycleId: "sessao-1-c1",
      iniciadoEm: "2026-10-17T12:00:00.000Z",
      concluidoEm: "2026-10-17T12:00:01.000Z",
      observacoes,
      eventosTemporais: [],
      resumoTemporal: { eventos: [], entidadesAtivas: 0 },
      metricas: { capturaMs: 10, deteccaoMs: 20, totalMs: 30 },
    },
    erros: [],
    cancelado: false,
    ...extras,
  };
}

describe("repositorio de observacoes", () => {
  it("grava, le as mais recentes primeiro e limpa", async () => {
    const arquivo = path.join(tmpDir, "visao.jsonl");
    await gravarObservacao(entrada("a"), arquivo, 1_000_000);
    await gravarObservacao(entrada("b"), arquivo, 1_000_000);

    const lidas = await lerObservacoes(arquivo, 10);
    expect(lidas.map((e) => e.resumo)).toEqual(["b", "a"]);

    await limparObservacoes(arquivo);
    expect(await readFile(arquivo, "utf8")).toBe("");
  });
});

describe("repositorio de eventos", () => {
  it("grava, le e controla a idempotencia por arquivo", async () => {
    const arquivo = path.join(tmpDir, "eventos.jsonl");
    await gravarEvento(evento("subiu"), arquivo, 1_000_000);
    expect((await lerEventos(arquivo, 10)).map((e) => e.descricao)).toEqual(["subiu"]);

    expect(eventoJaRegistrado(arquivo, "chave-1")).toBe(false);
    marcarEventoRegistrado(arquivo, "chave-1");
    expect(eventoJaRegistrado(arquivo, "chave-1")).toBe(true);

    // Limpar o arquivo invalida as chaves antigas.
    await limparEventos(arquivo);
    expect(eventoJaRegistrado(arquivo, "chave-1")).toBe(false);
  });
});

describe("repositorio operacional", () => {
  it("grava e le registros operacionais", async () => {
    const arquivo = path.join(tmpDir, "operacional.jsonl");
    await gravarOperacional(
      { timestamp: "x", nivel: "erro", origem: "cliente", mensagem: "falhou" },
      arquivo,
      1_000_000
    );
    const lidos = await lerOperacional(arquivo, 10);
    expect(lidos).toHaveLength(1);
    expect(lidos[0]).toMatchObject({ nivel: "erro", mensagem: "falhou" });
  });
});

describe("repositorio de ciclos", () => {
  it("grava, le e limpa registros de ciclo", async () => {
    const arquivo = path.join(tmpDir, "ciclos.jsonl");
    const registro = criarRegistroCiclo(resultadoCiclo([observacao("f1")]));
    await gravarCiclo(registro, arquivo, 1_000_000);
    await gravarCiclo({ ...registro, cycleId: "sessao-1-c2" }, arquivo, 1_000_000);

    const lidos = await lerCiclos(arquivo, 10);
    expect(lidos.map((c) => c.cycleId)).toEqual(["sessao-1-c2", "sessao-1-c1"]);

    await limparCiclos(arquivo);
    expect(await lerCiclos(arquivo, 10)).toEqual([]);
  });
});

describe("criarRegistroCiclo", () => {
  it("preserva as relacoes entre sessao, frames e eventos do ciclo", () => {
    const registro = criarRegistroCiclo(
      resultadoCiclo([observacao("f1", true), observacao("f2")]),
      { registroEm: "2026-10-17T12:00:02.000Z" }
    );
    expect(registro).toMatchObject({
      sessionId: "sessao-1",
      cycleId: "sessao-1-c1",
      frameIds: ["f1", "f2"],
      observacoes: 2,
      eventosTemporais: 0,
      subsistemasIndisponiveis: ["pose"],
      cancelado: false,
      registroEm: "2026-10-17T12:00:02.000Z",
    });
  });

  it("mantem o erro de etapa e o cancelamento no registro", () => {
    const registro = criarRegistroCiclo(
      resultadoCiclo([], {
        erros: [{ etapa: "multimodal", mensagem: "backend fora" }],
        cancelado: true,
      })
    );
    expect(registro.erros).toEqual([{ etapa: "multimodal", mensagem: "backend fora" }]);
    expect(registro.cancelado).toBe(true);
  });
});

describe("rotas de ciclos", () => {
  async function comServidor<T>(
    config: Parameters<typeof createServer>[0],
    tarefa: (base: string) => Promise<T>
  ): Promise<T> {
    const server = createServer(config);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    try {
      return await tarefa(`http://127.0.0.1:${port}`);
    } finally {
      server.close();
    }
  }

  it("grava, lista e limpa o diagnostico de um ciclo", async () => {
    const logFile = path.join(tmpDir, "visao.jsonl");
    const ciclosFile = path.join(tmpDir, "ciclos.jsonl");
    const registro = criarRegistroCiclo(resultadoCiclo([observacao("f1")]));

    await comServidor({ logFile, ciclosFile, publicDir: tmpDir }, async (base) => {
      const post = await fetch(`${base}/api/ciclos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(registro),
      });
      expect(post.status).toBe(200);

      const list = await fetch(`${base}/api/ciclos`);
      const corpo = (await list.json()) as { ok: boolean; total: number; ciclos: unknown[] };
      expect(corpo).toMatchObject({ ok: true, total: 1 });
      expect(corpo.ciclos[0]).toMatchObject({ cycleId: "sessao-1-c1", frameIds: ["f1"] });

      const del = await fetch(`${base}/api/ciclos`, { method: "DELETE" });
      expect(del.status).toBe(200);
      expect(await readFile(ciclosFile, "utf8")).toBe("");
    });
  });

  it("rejeita ciclo sem sessionId/cycleId", async () => {
    const logFile = path.join(tmpDir, "visao.jsonl");
    await comServidor({ logFile, publicDir: tmpDir }, async (base) => {
      const res = await fetch(`${base}/api/ciclos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frameIds: [] }),
      });
      expect(res.status).toBe(400);
    });
  });

  it("limpar historico (DELETE /api/logs) tambem apaga os ciclos", async () => {
    const logFile = path.join(tmpDir, "visao.jsonl");
    const ciclosFile = path.join(tmpDir, "ciclos.jsonl");
    const registro = criarRegistroCiclo(resultadoCiclo([observacao("f1")]));

    await comServidor({ logFile, ciclosFile, publicDir: tmpDir }, async (base) => {
      await fetch(`${base}/api/ciclos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(registro),
      });
      expect(await lerCiclos(ciclosFile, 10)).toHaveLength(1);

      const res = await fetch(`${base}/api/logs`, { method: "DELETE" });
      expect(res.status).toBe(200);
      expect(await lerCiclos(ciclosFile, 10)).toEqual([]);
    });
  });
});
