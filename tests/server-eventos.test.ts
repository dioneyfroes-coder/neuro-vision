import { describe, expect, it } from "vitest";
import { readdir } from "node:fs/promises";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { appendEvento } from "../src/server";
import { createServer } from "../src/server";
import { lerEventos } from "../src/server";
import { parsearInstante } from "../src/server";
import { parsearTiposEvento } from "../src/server";
import { validarPayloadEvento } from "../src/server";
import { registrarAmbienteTeste, tmpDir } from "./helpers/server-test-setup";

registrarAmbienteTeste();

describe("memoria persistente (eventos e operacional)", () => {
    it("validarPayloadEvento exige tipo, origem e descricao", () => {
      expect(validarPayloadEvento(null)).toBeTruthy();
      expect(validarPayloadEvento({ tipo: "aparicao" })).toBeTruthy();
      expect(validarPayloadEvento({ tipo: 1, origem: "rastreador", descricao: "x" })).toBeTruthy();
      expect(
        validarPayloadEvento({ tipo: "aparicao", origem: "rastreador", descricao: "apareceu" })
      ).toBeNull();
    });

    it("POST /api/eventos grava o evento e salva o snapshot", async () => {
      const logFile = path.join(tmpDir, "visao.jsonl");
      const eventosFile = path.join(tmpDir, "eventos.jsonl");
      const snapDir = path.join(tmpDir, "snapshots");
      const server = createServer({ logFile, eventosFile, snapDir, publicDir: tmpDir });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as AddressInfo;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/eventos`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tipo: "aparicao",
            origem: "rastreador",
            descricao: "apareceu pessoa",
            objetoId: "obj-1",
            confianca: 0.9,
            snapshot: "data:image/jpeg;base64,AAAA",
          }),
        });
        expect(res.status).toBe(200);
        const corpo = (await res.json()) as { ok: boolean; evento: { snapshot?: string } };
        expect(corpo.ok).toBe(true);
        expect(corpo.evento.snapshot).toMatch(/^\/snapshots\//);

        const evento = await lerEventos(eventosFile, 10);
        expect(evento).toHaveLength(1);
        expect(evento[0]).toMatchObject({ tipo: "aparicao", objetoId: "obj-1" });
      } finally {
        server.close();
      }
    });

    it("POST /api/eventos rejeita evento invalido", async () => {
      const logFile = path.join(tmpDir, "visao.jsonl");
      const eventosFile = path.join(tmpDir, "eventos.jsonl");
      const server = createServer({ logFile, eventosFile, publicDir: tmpDir });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as AddressInfo;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/eventos`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tipo: "inexistente", origem: "rastreador", descricao: "x" }),
        });
        expect(res.status).toBe(400);
        expect(await lerEventos(eventosFile, 10)).toHaveLength(0);
      } finally {
        server.close();
      }
    });

    it("POST /api/eventos com a mesma idempotencyKey nao duplica o evento", async () => {
      const logFile = path.join(tmpDir, "visao.jsonl");
      const eventosFile = path.join(tmpDir, "eventos.jsonl");
      const snapDir = path.join(tmpDir, "snapshots");
      const server = createServer({ logFile, eventosFile, snapDir, publicDir: tmpDir });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as AddressInfo;

      try {
        const corpo = {
          tipo: "aparicao",
          origem: "rastreador",
          descricao: "apareceu pessoa",
          snapshot: "data:image/jpeg;base64,AAAA",
          idempotencyKey: "chave-1",
        };
        const enviar = () =>
          fetch(`http://127.0.0.1:${port}/api/eventos`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(corpo),
          });

        const primeira = await enviar();
        expect(primeira.status).toBe(200);

        const segunda = await enviar();
        expect(segunda.status).toBe(200);
        expect(await segunda.json()).toMatchObject({ ok: true, duplicado: true });

        // O evento foi gravado uma unica vez e o snapshot nao foi reescrito.
        expect(await lerEventos(eventosFile, 10)).toHaveLength(1);
        expect(await readdir(snapDir)).toHaveLength(1);
      } finally {
        server.close();
      }
    });

    it("eventos da mesma captura compartilham um unico snapshot por hash", async () => {
      const logFile = path.join(tmpDir, "visao.jsonl");
      const eventosFile = path.join(tmpDir, "eventos.jsonl");
      const snapDir = path.join(tmpDir, "snapshots");
      const server = createServer({ logFile, eventosFile, snapDir, publicDir: tmpDir });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as AddressInfo;

      const enviar = (corpo: Record<string, unknown>) =>
        fetch(`http://127.0.0.1:${port}/api/eventos`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(corpo),
        });

      try {
        // Dois eventos do mesmo frame (mesmo conteudo de imagem) e um de outro.
        await enviar({
          tipo: "aparicao",
          origem: "rastreador",
          descricao: "a",
          frameId: "frame-1",
          idempotencyKey: "k1",
          snapshot: "data:image/jpeg;base64,QUJD",
        });
        await enviar({
          tipo: "movimento",
          origem: "rastreador",
          descricao: "m",
          frameId: "frame-1",
          idempotencyKey: "k2",
          snapshot: "data:image/jpeg;base64,QUJD",
        });
        await enviar({
          tipo: "aparicao",
          origem: "rastreador",
          descricao: "b",
          snapshot: "data:image/jpeg;base64,REVG",
          frameId: "frame-2",
          idempotencyKey: "chave-2",
        });

        const eventos = await lerEventos(eventosFile, 10);
        expect(eventos).toHaveLength(3);

        const porFrame = new Map(eventos.map((e) => [e.frameId, e.snapshot]));
        expect(porFrame.get("frame-1")).toBeDefined();
        expect(porFrame.get("frame-2")).toBeDefined();
        expect(porFrame.get("frame-1")).not.toBe(porFrame.get("frame-2"));
        // O snapshot foi deduplicado por conteudo: um arquivo por conteudo.
        expect(await readdir(snapDir)).toHaveLength(2);
      } finally {
        server.close();
      }
    });

    it("limpar eventos invalida as chaves de idempotencia anteriores", async () => {
      const logFile = path.join(tmpDir, "visao.jsonl");
      const eventosFile = path.join(tmpDir, "eventos.jsonl");
      const server = createServer({ logFile, eventosFile, publicDir: tmpDir });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as AddressInfo;

      const corpo = {
        tipo: "aparicao",
        origem: "rastreador",
        descricao: "apareceu pessoa",
        idempotencyKey: "chave-limpeza",
      };
      const enviar = () =>
        fetch(`http://127.0.0.1:${port}/api/eventos`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(corpo),
        });

      try {
        await enviar();
        expect(await lerEventos(eventosFile, 10)).toHaveLength(1);

        const limpeza = await fetch(`http://127.0.0.1:${port}/api/eventos`, {
          method: "DELETE",
        });
        expect(limpeza.status).toBe(200);

        // Apos limpar, a mesma chave volta a valer (arquivo novo).
        await enviar();
        expect(await lerEventos(eventosFile, 10)).toHaveLength(1);
      } finally {
        server.close();
      }
    });

    it("GET /api/eventos lista os ultimos eventos (mais recente primeiro)", async () => {
      const logFile = path.join(tmpDir, "visao.jsonl");
      const eventosFile = path.join(tmpDir, "eventos.jsonl");
      await appendEvento(
        { id: "e1", timestamp: "t1", tipo: "aparicao", descricao: "primeiro", origem: "rastreador" },
        eventosFile
      );
      await appendEvento(
        { id: "e2", timestamp: "t2", tipo: "desaparecimento", descricao: "segundo", origem: "rastreador" },
        eventosFile
      );

      const server = createServer({ logFile, eventosFile, publicDir: tmpDir });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as AddressInfo;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/eventos?limit=1`);
        expect(res.status).toBe(200);
        const corpo = (await res.json()) as { ok: boolean; eventos: { id: string }[] };
        expect(corpo.ok).toBe(true);
        expect(corpo.eventos).toHaveLength(1);
        expect(corpo.eventos[0].id).toBe("e2");
      } finally {
        server.close();
      }
    });

    it("GET /api/eventos filtra por tipo, objeto e janela temporal", async () => {
      const logFile = path.join(tmpDir, "visao.jsonl");
      const eventosFile = path.join(tmpDir, "eventos.jsonl");
      await appendEvento(
        {
          id: "e1",
          timestamp: "2026-10-11T10:00:00.000Z",
          tipo: "aparicao",
          objetoId: "obj-1",
          descricao: "apareceu pessoa",
          origem: "rastreador",
        },
        eventosFile
      );
      await appendEvento(
        {
          id: "e2",
          timestamp: "2026-10-11T10:01:00.000Z",
          tipo: "movimento",
          objetoId: "obj-2",
          descricao: "movimento",
          origem: "rastreador",
        },
        eventosFile
      );

      const server = createServer({ logFile, eventosFile, publicDir: tmpDir });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as AddressInfo;
      const base = `http://127.0.0.1:${port}/api/eventos`;

      try {
        const porTipo = (await (await fetch(`${base}?tipo=movimento`)).json()) as {
          eventos: { id: string }[];
        };
        expect(porTipo.eventos.map((e) => e.id)).toEqual(["e2"]);

        const porObjeto = (await (await fetch(`${base}?objetoId=obj-1`)).json()) as {
          eventos: { id: string }[];
        };
        expect(porObjeto.eventos.map((e) => e.id)).toEqual(["e1"]);

        const porJanela = (await (
          await fetch(`${base}?desde=2026-10-11T10:00:30.000Z`)
        ).json()) as { eventos: { id: string }[] };
        expect(porJanela.eventos.map((e) => e.id)).toEqual(["e2"]);

        // Tipo desconhecido nao restringe (lista vazia de filtros).
        const tipoInvalido = (await (await fetch(`${base}?tipo=inexistente`)).json()) as {
          eventos: { id: string }[];
        };
        expect(tipoInvalido.eventos).toHaveLength(2);
      } finally {
        server.close();
      }
    });

    it("parsearTiposEvento e parsearInstante normalizam a query", () => {
      expect(parsearTiposEvento("aparicao,movimento,aparicao")).toEqual(["aparicao", "movimento"]);
      expect(parsearTiposEvento("inexistente")).toEqual([]);
      expect(parsearTiposEvento(null)).toEqual([]);
      expect(parsearInstante("1728000000000")).toBe(1728000000000);
      expect(parsearInstante("2026-10-11T00:00:00.000Z")).toBe(
        Date.parse("2026-10-11T00:00:00.000Z")
      );
      expect(parsearInstante("")).toBeUndefined();
      expect(parsearInstante(null)).toBeUndefined();
      expect(parsearInstante("nao-e-data")).toBeUndefined();
    });
});
