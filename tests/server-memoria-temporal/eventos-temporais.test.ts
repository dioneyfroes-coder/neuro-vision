import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { appendEventoTemporal, createServer, lerEventos, lerEventosTemporais } from "../../src/server";
import type { EventoTemporalPersistido } from "../../src/types";
import { registrarAmbienteTeste, tmpDir } from "../helpers/server-test-setup";

registrarAmbienteTeste();

describe("memoria persistente - eventos temporais", () => {
  it("POST /api/eventos-temporais grava gestos, aceita incerto e e idempotente", async () => {
    const logFile = path.join(tmpDir, "visao.jsonl");
    const eventosTemporaisFile = path.join(tmpDir, "eventos-temporais.jsonl");
    const server = createServer({ logFile, eventosTemporaisFile, publicDir: tmpDir });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}/api/eventos-temporais`;

    const gesto = {
      eventoId: "evt-gesto-1",
      sessionId: "sessao-1",
      cycleId: "ciclo-1",
      tipo: "gesto_detectado",
      inicioEm: "2026-11-02T10:00:00.000Z",
      ultimaEvidenciaEm: "2026-11-02T10:00:01.000Z",
      ultimaObservacaoEm: "2026-11-02T10:00:01.200Z",
      entidadeId: "pessoa-1",
      descricao: "mao levantada",
      confianca: 0.9,
      origens: ["pose"],
      frameIds: ["f1", "f2"],
      estado: "confirmado",
      idempotencyKey: "evt-gesto-1:confirmado",
    };
    const enviar = (corpo: unknown) =>
      fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });

    try {
      const primeira = await enviar(gesto);
      expect(primeira.status).toBe(200);
      const segunda = await enviar(gesto);
      expect(segunda.status).toBe(200);
      expect(await segunda.json()).toMatchObject({ ok: true, duplicado: true });

      const incerto = {
        ...gesto,
        eventoId: "evt-gesto-2",
        estado: "incerto",
        intervaloSemObservacaoMs: 2500,
        idempotencyKey: "evt-gesto-2:incerto",
      };
      expect((await enviar(incerto)).status).toBe(200);

      const gravados = await lerEventosTemporais(eventosTemporaisFile, 10);
      expect(gravados).toHaveLength(2);
      expect(gravados.find((e) => e.eventoId === "evt-gesto-2")).toMatchObject({
        estado: "incerto",
        intervaloSemObservacaoMs: 2500,
        frameIds: ["f1", "f2"],
      });
      expect(gravados.every((e) => typeof e.registradoEm === "string")).toBe(true);
      // O stream temporal nao mistura fatos visuais no arquivo legado.
      expect(await lerEventos(path.join(tmpDir, "eventos.jsonl"), 10)).toHaveLength(0);

      // Candidato e tipo visual nao entram na memoria de gestos/posturas.
      expect((await enviar({ ...gesto, estado: "candidato" })).status).toBe(400);
      expect((await enviar({ ...gesto, tipo: "aparicao" })).status).toBe(400);
      expect(await lerEventosTemporais(eventosTemporaisFile, 10)).toHaveLength(2);
    } finally {
      server.close();
    }
  });

  it("GET /api/eventos-temporais filtra por tipo, estado, entidade e janela", async () => {
    const logFile = path.join(tmpDir, "visao.jsonl");
    const eventosTemporaisFile = path.join(tmpDir, "eventos-temporais.jsonl");
    const baseEvento: Omit<
      EventoTemporalPersistido,
      "eventoId" | "tipo" | "estado" | "idempotencyKey"
    > = {
      sessionId: "s",
      inicioEm: "2026-11-02T10:00:00.000Z",
      descricao: "evento",
      origens: ["pose"],
      frameIds: ["f1"],
      registradoEm: "2026-11-02T10:00:01.000Z",
    };
    await appendEventoTemporal(
      {
        ...baseEvento,
        eventoId: "evt-1",
        tipo: "gesto_detectado",
        estado: "confirmado",
        entidadeId: "p1",
        idempotencyKey: "evt-1:confirmado",
      },
      eventosTemporaisFile
    );
    await appendEventoTemporal(
      {
        ...baseEvento,
        eventoId: "evt-2",
        tipo: "braco_levantado",
        estado: "incerto",
        entidadeId: "p2",
        inicioEm: "2026-11-02T10:05:00.000Z",
        intervaloSemObservacaoMs: 3000,
        idempotencyKey: "evt-2:incerto",
      },
      eventosTemporaisFile
    );

    const server = createServer({ logFile, eventosTemporaisFile, publicDir: tmpDir });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}/api/eventos-temporais`;

    try {
      const porTipo = (await (await fetch(`${base}?tipo=gesto_detectado`)).json()) as {
        eventos: { eventoId: string }[];
      };
      expect(porTipo.eventos.map((e) => e.eventoId)).toEqual(["evt-1"]);

      const porEstado = (await (await fetch(`${base}?estado=incerto`)).json()) as {
        eventos: { eventoId: string }[];
      };
      expect(porEstado.eventos.map((e) => e.eventoId)).toEqual(["evt-2"]);

      const porEntidade = (await (await fetch(`${base}?entidadeId=p1`)).json()) as {
        eventos: { eventoId: string }[];
      };
      expect(porEntidade.eventos.map((e) => e.eventoId)).toEqual(["evt-1"]);

      const porJanela = (await (
        await fetch(`${base}?desde=2026-11-02T10:02:00.000Z`)
      ).json()) as { eventos: { eventoId: string }[] };
      expect(porJanela.eventos.map((e) => e.eventoId)).toEqual(["evt-2"]);

      // Tipo desconhecido nao restringe.
      const tipoInvalido = (await (await fetch(`${base}?tipo=aparicao`)).json()) as {
        eventos: { eventoId: string }[];
      };
      expect(tipoInvalido.eventos).toHaveLength(2);
    } finally {
      server.close();
    }
  });

  it("DELETE /api/eventos-temporais esvazia a memoria e libera a chave idempotente", async () => {
    const logFile = path.join(tmpDir, "visao.jsonl");
    const eventosTemporaisFile = path.join(tmpDir, "eventos-temporais.jsonl");
    const server = createServer({ logFile, eventosTemporaisFile, publicDir: tmpDir });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}/api/eventos-temporais`;
    const corpo = {
      eventoId: "evt-1",
      sessionId: "s",
      tipo: "movimento_corporal",
      inicioEm: "2026-11-02T10:00:00.000Z",
      descricao: "movimento",
      origens: ["movimento"],
      frameIds: ["f1"],
      estado: "encerrado",
      idempotencyKey: "evt-1:encerrado",
    };
    const enviar = () =>
      fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });

    try {
      await enviar();
      expect(await lerEventosTemporais(eventosTemporaisFile, 10)).toHaveLength(1);

      const limpeza = await fetch(base, { method: "DELETE" });
      expect(limpeza.status).toBe(200);
      expect(await readFile(eventosTemporaisFile, "utf8")).toBe("");

      // Apos limpar, a mesma chave volta a valer (stream novo).
      await enviar();
      expect(await lerEventosTemporais(eventosTemporaisFile, 10)).toHaveLength(1);
    } finally {
      server.close();
    }
  });

});
