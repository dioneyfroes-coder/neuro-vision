import { describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { appendEvento, arquivosDeMemoria, limparSnapshots, montarEventoTemporal } from "../../src/server";
import { registrarAmbienteTeste, tmpDir } from "../helpers/server-test-setup";

registrarAmbienteTeste();

describe("memoria persistente - utilitarios", () => {
  it("montarEventoTemporal normaliza campos opcionais e rejeita estado candidato", () => {
    const base = {
      eventoId: "evt-1",
      sessionId: "s",
      tipo: "gesto_detectado",
      inicioEm: "2026-11-02T10:00:00.000Z",
      descricao: "gesto",
      estado: "confirmado",
      idempotencyKey: "evt-1:confirmado",
      origens: ["pose", "invalida"],
      frameIds: ["f1", 2],
      confianca: 1.4,
      intervaloSemObservacaoMs: 1200,
    };
    const evento = montarEventoTemporal(base);
    expect(evento).toMatchObject({
      eventoId: "evt-1",
      tipo: "gesto_detectado",
      estado: "confirmado",
      origens: ["pose"],
      frameIds: ["f1"],
      confianca: 1.4,
      intervaloSemObservacaoMs: 1200,
    });
    expect(typeof evento?.registradoEm).toBe("string");
    expect(montarEventoTemporal({ ...base, estado: "candidato" })).toBeNull();
    expect(montarEventoTemporal({ ...base, tipo: "aparicao" })).toBeNull();
  });

  it("deriva o status no servidor e registra o instante de persistência", () => {
    const capturadoEmMs = Date.parse("2026-11-22T10:00:00.000Z");
    const evento = montarEventoTemporal({
      eventoId: "evt-2",
      sessionId: "s",
      tipo: "interacao_objeto",
      inicioEm: "2026-11-22T10:00:00.000Z",
      descricao: "objeto apareceu",
      estado: "confirmado",
      idempotencyKey: "evt-2:confirmado",
      frameIds: ["f1"],
      capturadoEmMs,
      processadoEmMs: capturadoEmMs + 30,
      inferidoEmMs: capturadoEmMs + 40,
      // Valores enviados pelo cliente não podem substituir o relógio do servidor.
      persistidoEmMs: 1,
      statusEvidencia: "falha_percepcao",
    });
    expect(evento).toMatchObject({
      capturadoEmMs,
      processadoEmMs: capturadoEmMs + 30,
      inferidoEmMs: capturadoEmMs + 40,
      statusEvidencia: "observado",
    });
    expect(evento?.persistidoEmMs).toBeGreaterThan(1);
    expect(evento?.registradoEmMs).toBe(evento?.persistidoEmMs);
  });

  it("limparSnapshots preserva snapshot referenciado por um evento", async () => {
    const logFile = path.join(tmpDir, "visao.jsonl");
    const eventosFile = path.join(tmpDir, "eventos.jsonl");
    const snapDir = path.join(tmpDir, "snapshots");
    await mkdir(snapDir, { recursive: true });
    await writeFile(path.join(snapDir, "vinculado.jpg"), "BLOB");
    await appendEvento(
      {
        id: "e1",
        timestamp: "t",
        tipo: "aparicao",
        descricao: "apareceu",
        origem: "rastreador",
        snapshot: "/snapshots/vinculado.jpg",
      },
      eventosFile
    );

    const resultado = await limparSnapshots({
      snapDir,
      logFiles: arquivosDeMemoria(logFile, eventosFile),
    });
    expect(resultado.removidos).toBe(0);
    expect(resultado.mantidos).toBe(1);
  });

});
