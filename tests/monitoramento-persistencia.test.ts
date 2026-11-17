import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  gravarSegmentoMonitoramento,
  gravarSessaoMonitoramento,
  lerSegmentosDaSessao,
  lerSegmentosMonitoramento,
  lerSessoesMonitoramento,
} from "../src/persistence/repositorio-monitoramento";
import {
  ConflitoMonitoramentoError,
  ServicoMonitoramento,
} from "../src/monitoramento/servico-monitoramento";
import type { QuadroGravado, SessaoMonitoramento, VideoSegment } from "../src/domain";

/**
 * Indice duravel e servico de monitoramento (Fase 3).
 *
 * Assim como o nucleo, o servico nao le o relogio: os testes entregam
 * `agoraMs`/`capturadoEmMs` sinteticos e comparam o indice gravado.
 */

const BASE = 1_700_000_000_000;
const MAX_BYTES = 1_000_000;

let tmpDir: string;
let sessoesFile: string;
let segmentosFile: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "neuro-monitoramento-"));
  sessoesFile = path.join(tmpDir, "monitoramento-sessoes.jsonl");
  segmentosFile = path.join(tmpDir, "monitoramento-segmentos.jsonl");
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function quadro(frameId: string, offsetMs: number): QuadroGravado {
  return { frameId, capturadoEmMs: BASE + offsetMs };
}

function sessao(overrides: Partial<SessaoMonitoramento> = {}): SessaoMonitoramento {
  return {
    sessaoId: "sessao-1",
    ambiente: "sala",
    iniciadaEm: new Date(BASE).toISOString(),
    iniciadaEmMs: BASE,
    estado: "ativa",
    duracaoSegmentoMs: 60_000,
    retencaoPreEventoMs: 10_000,
    limiarLacunaMs: 2000,
    ...overrides,
  };
}

function segmento(
  segmentoId: string,
  sequencia: number,
  overrides: Partial<VideoSegment> = {}
): VideoSegment {
  const inicioMs = BASE + sequencia * 1000;
  return {
    segmentoId,
    sessaoId: "sessao-1",
    sequencia,
    inicioEm: new Date(inicioMs).toISOString(),
    inicioMs,
    fimEm: new Date(inicioMs + 1000).toISOString(),
    fimMs: inicioMs + 1000,
    duracaoMs: 1000,
    quadros: 1,
    estado: "fechado",
    motivoFim: "duracao",
    lacunas: [],
    ...overrides,
  };
}

async function linhas(filePath: string): Promise<number> {
  try {
    const texto = await readFile(filePath, "utf8");
    return texto.split("\n").filter((linha) => linha.trim()).length;
  } catch {
    return 0;
  }
}

function novoSevico(): ServicoMonitoramento {
  return new ServicoMonitoramento({ sessoesFile, segmentosFile, maxBytes: MAX_BYTES });
}

describe("repositorio de monitoramento", () => {
  it("mantem apenas a versao mais recente de cada sessao", async () => {
    await gravarSessaoMonitoramento(sessao(), sessoesFile, MAX_BYTES);
    await gravarSessaoMonitoramento(
      sessao({ estado: "encerrada", encerradaEmMs: BASE + 5000 }),
      sessoesFile,
      MAX_BYTES
    );

    const sessoes = await lerSessoesMonitoramento(sessoesFile, 100);
    expect(sessoes).toHaveLength(1);
    expect(sessoes[0]).toMatchObject({ sessaoId: "sessao-1", estado: "encerrada" });
  });

  it("mantem apenas a versao mais recente de cada segmento, em ordem cronologica", async () => {
    await gravarSegmentoMonitoramento(segmento("seg-2", 2), segmentosFile, MAX_BYTES);
    await gravarSegmentoMonitoramento(segmento("seg-1", 1), segmentosFile, MAX_BYTES);
    await gravarSegmentoMonitoramento(
      segmento("seg-2", 2, { estado: "incompleto", motivoFim: "lacuna", quadros: 4 }),
      segmentosFile,
      MAX_BYTES
    );

    const segmentos = await lerSegmentosMonitoramento(segmentosFile, 100);
    expect(segmentos.map((s) => s.segmentoId)).toEqual(["seg-1", "seg-2"]);
    expect(segmentos[1]).toMatchObject({
      estado: "incompleto",
      motivoFim: "lacuna",
      quadros: 4,
    });
  });

  it("filtra segmentos por sessao sem confundir indices de outra sessao", async () => {
    await gravarSegmentoMonitoramento(segmento("seg-1", 1), segmentosFile, MAX_BYTES);
    await gravarSegmentoMonitoramento(
      segmento("seg-outra", 1, { sessaoId: "sessao-2" }),
      segmentosFile,
      MAX_BYTES
    );

    const daSessao = await lerSegmentosDaSessao(segmentosFile, "sessao-1", 100);
    expect(daSessao.map((s) => s.segmentoId)).toEqual(["seg-1"]);
  });
});

describe("ServicoMonitoramento - indice duravel", () => {
  it("grava 30 minutos sem perder segmentos e sem uma linha por quadro", async () => {
    const servico = novoSevico();
    const sessao = await servico.iniciar({ ambiente: "garagem", agoraMs: BASE, duracaoSegmentoMs: 1000 });

    // 30 quadros a cada 100 ms (3 s): tres segmentos de 1 s.
    for (let i = 0; i < 30; i += 1) {
      await servico.enviarQuadros([quadro(`f${i}`, i * 100)]);
    }
    const sessaoFinal = await servico.encerrar(sessao.sessaoId, BASE + 3000);
    expect(sessaoFinal.estado).toBe("encerrada");
    const segmentos = await servico.segmentosDaSessao(sessaoFinal.sessaoId);
    expect(segmentos.map((s) => s.sequencia)).toEqual([1, 2, 3]);
    expect(segmentos.map((s) => s.quadros)).toEqual([10, 10, 10]);
    expect(segmentos.map((s) => s.estado)).toEqual(["fechado", "fechado", "fechado"]);
    expect(segmentos.map((s) => s.motivoFim)).toEqual([
      "duracao",
      "duracao",
      "sessao_encerrada",
    ]);

    // Cada segmento gera duas linhas: abertura (`gravando`) e desfecho.
    expect(await linhas(segmentosFile)).toBe(segmentos.length * 2);
    expect(await linhas(sessoesFile)).toBe(2); // inicio + encerramento
  });

  it("reconstroi o indice depois de reiniciar o processo", async () => {
    const primeiro = novoSevico();
    const sessaoAberta = await primeiro.iniciar({
      ambiente: "quintal",
      agoraMs: BASE,
      duracaoSegmentoMs: 1000,
      limiarLacunaMs: 1000,
    });
    await primeiro.enviarQuadros([quadro("f0", 0), quadro("f1", 1200), quadro("f2", 1500)]);
    await primeiro.encerrar(sessaoAberta.sessaoId, BASE + 2000);

    // Um segundo servico com os mesmos arquivos nao tem sessao viva, mas le o
    // historico persistido - inclusive as lacunas explicitas.
    const segundo = novoSevico();
    expect(segundo.sessaoAtual()).toBeNull();

    const sessoes = await segundo.listarSessoes();
    expect(sessoes).toHaveLength(1);
    expect(sessoes[0]).toMatchObject({
      sessaoId: sessaoAberta.sessaoId,
      ambiente: "quintal",
      estado: "encerrada",
    });

    const segmentos = await segundo.segmentosDaSessao(sessaoAberta.sessaoId);
    expect(segmentos.map((s) => s.estado)).toEqual(["incompleto", "fechado"]);
    expect(segmentos[0].lacunas[0]).toMatchObject({
      inicioMs: BASE,
      fimMs: BASE + 1200,
      motivo: "sem_quadros",
    });
  });

  it("pausa e retomada persistem segmentos separados, sem lacuna", async () => {
    const servico = novoSevico();
    const aberta = await servico.iniciar({ ambiente: "sala", agoraMs: BASE });
    await servico.enviarQuadros([quadro("f0", 0)]);
    await servico.pausar(aberta.sessaoId);
    await servico.retomar(aberta.sessaoId);
    await servico.enviarQuadros([quadro("f1", 9000)]);
    await servico.encerrar(aberta.sessaoId, BASE + 9500);

    const segmentos = await servico.segmentosDaSessao(aberta.sessaoId);
    expect(segmentos).toHaveLength(2);
    expect(segmentos[0]).toMatchObject({ motivoFim: "pausa", estado: "fechado", fimMs: BASE });
    expect(segmentos[1]).toMatchObject({
      inicioMs: BASE + 9000,
      motivoFim: "sessao_encerrada",
    });
    expect(segmentos.flatMap((s) => s.lacunas)).toEqual([]);
  });

  it("interrupcao publica o segmento em curso como incompleto", async () => {
    const servico = novoSevico();
    const aberta = await servico.iniciar({ ambiente: "sala", agoraMs: BASE });
    await servico.enviarQuadros([quadro("f0", 0)]);
    await servico.interromper(aberta.sessaoId, BASE + 4000);

    const segmentos = await servico.segmentosDaSessao(aberta.sessaoId);
    expect(segmentos).toHaveLength(1);
    expect(segmentos[0]).toMatchObject({
      estado: "incompleto",
      motivoFim: "lacuna",
      fimMs: BASE,
    });
    expect(segmentos[0].lacunas[0]).toMatchObject({
      inicioMs: BASE,
      fimMs: BASE + 4000,
      motivo: "falha",
    });
    const sessoes = await servico.listarSessoes();
    expect(sessoes[0].estado).toBe("interrompida");
  });

  it("um quadro recusado nao interrompe os demais do lote", async () => {
    const servico = novoSevico();
    await servico.iniciar({ ambiente: "sala", agoraMs: BASE });
    const resultado = await servico.enviarQuadros([
      quadro("f0", 1000),
      quadro("fora-de-ordem", 900),
      quadro("f1", 1100),
      quadro("futuro", 1200),
    ]);

    expect(resultado.atribuicoes.map((a) => a.frameId)).toEqual(["f0", "f1", "futuro"]);
    expect(resultado.rejeitados).toEqual([
      expect.objectContaining({ frameId: "fora-de-ordem", motivo: "fora_de_ordem" }),
    ]);
  });

  it("recusa abrir uma segunda sessao e comandos para outra sessao", async () => {
    const servico = novoSevico();
    const aberta = await servico.iniciar({ ambiente: "sala", agoraMs: BASE });

    await expect(servico.iniciar({ ambiente: "outra", agoraMs: BASE })).rejects.toBeInstanceOf(
      ConflitoMonitoramentoError
    );
    await expect(servico.pausar("outra-sessao")).rejects.toBeInstanceOf(
      ConflitoMonitoramentoError
    );
    await expect(servico.encerrar(aberta.sessaoId, BASE + 1000)).resolves.toMatchObject({
      estado: "encerrada",
    });
  });

  it("serializa lote e encerramento concorrentes sem deixar segmento gravando no indice", async () => {
    const servico = novoSevico();
    const aberta = await servico.iniciar({
      ambiente: "sala",
      agoraMs: BASE,
      duracaoSegmentoMs: 60_000,
    });

    // Duas mutacoes disparadas juntas: a fila interna decide a ordem. Em
    // qualquer ordem, o indice nao pode terminar com um segmento `gravando`
    // para uma sessao encerrada.
    await Promise.all([
      servico.enviarQuadros([quadro("f0", 0), quadro("f1", 1000)]),
      servico.encerrar(aberta.sessaoId, BASE + 2000),
    ]);

    const leitor = novoSevico();
    const segmentos = await leitor.segmentosDaSessao(aberta.sessaoId);
    expect(segmentos.every((segmento) => segmento.estado !== "gravando")).toBe(true);
    const sessoes = await leitor.listarSessoes();
    expect(sessoes[0].estado).toBe("encerrada");
  });

  it("consulta intervalos com extremos inclusivos sobre o indice", async () => {
    const servico = novoSevico();
    const aberta = await servico.iniciar({
      ambiente: "sala",
      agoraMs: BASE,
      duracaoSegmentoMs: 1000,
    });
    await servico.enviarQuadros([quadro("f0", 0), quadro("f1", 900), quadro("f2", 1000)]);

    const noLimite = await servico.segmentosParaIntervalo(BASE + 1000, BASE + 1000);
    expect(noLimite.map((s) => s.sequencia)).toEqual([1, 2]);
    // O trecho depois do ultimo quadro nao esta coberto.
    expect(await servico.segmentosParaIntervalo(BASE + 1001, BASE + 2000)).toEqual([]);
    expect((await servico.segmentosDaSessao(aberta.sessaoId)).map((s) => s.quadros)).toEqual([
      2, 1,
    ]);
  });
});
