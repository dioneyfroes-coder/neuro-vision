import { describe, expect, it, vi } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { appendEvento } from "../src/server";
import { appendEventoTemporal } from "../src/server";
import { appendLogEntry } from "../src/server";
import { appendOperacional } from "../src/server";
import { arquivosDeMemoria } from "../src/server";
import { createServer } from "../src/server";
import { lerEventos } from "../src/server";
import { lerEventosTemporais } from "../src/server";
import { lerOperacional } from "../src/server";
import { limparSnapshots } from "../src/server";
import { montarEventoTemporal } from "../src/server";
import { registrarFalha } from "../src/server";
import type { EventoTemporalPersistido } from "../src/types";
import { registrarAmbienteTeste, tmpDir } from "./helpers/server-test-setup";

registrarAmbienteTeste();

describe("memoria persistente (eventos e operacional)", () => {
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

    it("GET /api/contexto reidrata roteiro e ultima descricao do historico", async () => {
      const logFile = path.join(tmpDir, "visao.jsonl");
      const eventosFile = path.join(tmpDir, "eventos.jsonl");
      await appendLogEntry(
        { timestamp: "t1", modelo: "m", objetos: [], resumo: "pessoa na sala", tipo: "descricao" },
        logFile
      );
      await appendLogEntry(
        { timestamp: "t2", modelo: "m", objetos: [], resumo: "virou a esquerda", tipo: "roteiro", papel: "delta" },
        logFile
      );

      const server = createServer({ logFile, eventosFile, publicDir: tmpDir });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as AddressInfo;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/contexto`);
        expect(res.status).toBe(200);
        const corpo = (await res.json()) as {
          ok: boolean;
          roteiro: string[];
          ultimaDescricao: string;
          resumo: string;
        };
        expect(corpo.ok).toBe(true);
        expect(corpo.roteiro).toEqual(["virou a esquerda"]);
        expect(corpo.ultimaDescricao).toBe("virou a esquerda");
        expect(corpo.resumo).toContain("virou a esquerda");
      } finally {
        server.close();
      }
    });

    it("GET /api/contexto devolve contexto vazio sem historico (log vazio)", async () => {
      const logFile = path.join(tmpDir, "visao.jsonl");
      const eventosFile = path.join(tmpDir, "eventos.jsonl");
      const server = createServer({ logFile, eventosFile, publicDir: tmpDir });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as AddressInfo;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/contexto`);
        expect(res.status).toBe(200);
        const corpo = (await res.json()) as { roteiro: string[]; ultimaDescricao: string; resumo: string };
        expect(corpo.roteiro).toEqual([]);
        expect(corpo.ultimaDescricao).toBe("");
        expect(corpo.resumo).toBe("");
      } finally {
        server.close();
      }
    });

    it("GET /api/contexto tolera linhas invalidas no arquivo de log", async () => {
      const logFile = path.join(tmpDir, "visao.jsonl");
      const eventosFile = path.join(tmpDir, "eventos.jsonl");
      await writeFile(
        logFile,
        [
          "{ linha corrompida",
          JSON.stringify({ timestamp: "t1", modelo: "m", objetos: [], resumo: "valida", tipo: "descricao" }),
        ].join("\n") + "\n",
        "utf8"
      );

      const server = createServer({ logFile, eventosFile, publicDir: tmpDir });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const { port } = server.address() as AddressInfo;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/contexto`);
        expect(res.status).toBe(200);
        const corpo = (await res.json()) as { ultimaDescricao: string };
        expect(corpo.ultimaDescricao).toBe("valida");
      } finally {
        server.close();
      }
    });
});
