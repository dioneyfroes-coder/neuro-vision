import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AddressInfo } from "node:net";
import {
  appendEvento,
  appendEventoTemporal,
  appendLogEntry,
  appendOperacional,
  createServer,
  lerEventos,
  lerOperacional,
  registrarFalha,
} from "../../src/server";
import { registrarAmbienteTeste, tmpDir } from "../helpers/server-test-setup";

registrarAmbienteTeste();

describe("memoria persistente - operacional", () => {
  it("appendOperacional/lerOperacional guardam registros operacionais", async () => {
    const operacionalFile = path.join(tmpDir, "operacional.jsonl");
    await appendOperacional(
      { timestamp: "t1", nivel: "aviso", origem: "servidor", mensagem: "primeiro" },
      operacionalFile
    );
    await appendOperacional(
      { timestamp: "t2", nivel: "erro", origem: "cliente", mensagem: "segundo" },
      operacionalFile
    );
    const lidos = await lerOperacional(operacionalFile, 10);
    expect(lidos.map((r) => r.mensagem)).toEqual(["segundo", "primeiro"]);
  });

  it("registrarFalha espelha console e operacional.jsonl", async () => {
    const operacionalFile = path.join(tmpDir, "operacional-falha.jsonl");
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      registrarFalha("error", "upload_falhou", { erro: "HTTP 500" }, operacionalFile);
      await vi.waitFor(async () => {
        const lidos = await lerOperacional(operacionalFile, 10);
        expect(lidos).toHaveLength(1);
        expect(lidos[0]).toMatchObject({
          nivel: "erro",
          origem: "servidor",
          mensagem: "upload_falhou",
        });
        expect(lidos[0].detalhe).toContain("HTTP 500");
      });
      expect(erro).toHaveBeenCalled();
    } finally {
      erro.mockRestore();
    }
  });

  it("POST /api/operacional grava um registro sem virar evento visual", async () => {
    const logFile = path.join(tmpDir, "visao.jsonl");
    const eventosFile = path.join(tmpDir, "eventos.jsonl");
    const operacionalFile = path.join(tmpDir, "operacional.jsonl");
    const server = createServer({ logFile, eventosFile, operacionalFile, publicDir: tmpDir });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/operacional`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nivel: "erro", origem: "cliente", mensagem: "falha ao gravar" }),
      });
      expect(res.status).toBe(200);
      const conteudo = await readFile(operacionalFile, "utf8");
      expect(conteudo).toContain("falha ao gravar");
      expect(await lerEventos(eventosFile, 10)).toHaveLength(0);
    } finally {
      server.close();
    }
  });

  it("DELETE /api/logs limpa tambem os eventos visuais e a memoria temporal", async () => {
    const logFile = path.join(tmpDir, "visao.jsonl");
    const eventosFile = path.join(tmpDir, "eventos.jsonl");
    const eventosTemporaisFile = path.join(tmpDir, "eventos-temporais.jsonl");
    await appendLogEntry(
      { timestamp: "x", modelo: "m", objetos: [], resumo: "a", tipo: "deteccao" },
      logFile
    );
    await appendEvento(
      { id: "e1", timestamp: "t", tipo: "aparicao", descricao: "x", origem: "rastreador" },
      eventosFile
    );
    await appendEventoTemporal(
      {
        eventoId: "evt-1",
        sessionId: "s",
        tipo: "gesto_detectado",
        inicioEm: "2026-11-02T10:00:00.000Z",
        descricao: "gesto",
        origens: ["pose"],
        frameIds: ["f1"],
        estado: "confirmado",
        idempotencyKey: "evt-1:confirmado",
        registradoEm: "2026-11-02T10:00:01.000Z",
      },
      eventosTemporaisFile
    );

    const server = createServer({ logFile, eventosFile, eventosTemporaisFile, publicDir: tmpDir });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/logs`, { method: "DELETE" });
      expect(res.status).toBe(200);
      expect(await readFile(logFile, "utf8")).toBe("");
      expect(await readFile(eventosFile, "utf8")).toBe("");
      expect(await readFile(eventosTemporaisFile, "utf8")).toBe("");
    } finally {
      server.close();
    }
  });

});
