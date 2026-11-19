import { describe, expect, it } from "vitest";
import type { LacunaGravacao, VideoSegment } from "../src/domain/monitoramento";
import {
  avaliarSoak,
  type AmostraTelemetria,
  type EntradaAvaliacaoSoak,
} from "../src/monitoramento/validacao-soak";

/**
 * Avaliação do soak com timestamps sintéticos: nada aqui lê relógio, arquivo ou
 * rede. As janelas injetadas usam epoch ms para ficarem na mesma linha do tempo
 * das lacunas registradas nos segmentos (o harness converte antes de avaliar).
 */
const BASE = 1_700_000_000_000;
const MB = 1024 * 1024;
const ISO = "2023-11-14T22:13:20.000Z";

function amostra(sobre: Partial<AmostraTelemetria> = {}): AmostraTelemetria {
  return {
    emMs: 0,
    usoPercentualCpu: 10,
    rssBytes: 100 * MB,
    heapBytes: 40 * MB,
    bytesVideo: 2 * 1024,
    quadros: 4,
    segmentos: 2,
    lacunas: 1,
    ...sobre,
  };
}

function lacuna(inicioMs: number, fimMs: number): LacunaGravacao {
  return {
    inicioEm: ISO,
    inicioMs: BASE + inicioMs,
    fimEm: ISO,
    fimMs: BASE + fimMs,
    duracaoMs: fimMs - inicioMs,
    motivo: "sem_quadros",
  };
}

function segmento(
  id: string,
  inicioMs: number,
  fimMs: number,
  quadros: number,
  lacunas: LacunaGravacao[] = []
): VideoSegment {
  return {
    segmentoId: id,
    sessaoId: "sessao-1",
    sequencia: Number(id.replace(/\D/g, "")) || 1,
    inicioEm: ISO,
    inicioMs: BASE + inicioMs,
    fimEm: ISO,
    fimMs: BASE + fimMs,
    duracaoMs: fimMs - inicioMs,
    quadros,
    estado: "fechado",
    lacunas,
  };
}

function entradaBase(): EntradaAvaliacaoSoak {
  return {
    amostras: [
      amostra({ emMs: 0, usoPercentualCpu: null }),
      amostra({ emMs: 120_000, rssBytes: 110 * MB, usoPercentualCpu: 25 }),
    ],
    segmentos: [
      segmento("seg-1", 0, 30_000, 2, [lacuna(10_000, 12_000)]),
      segmento("seg-2", 30_000, 60_000, 2),
    ],
    quadrosEnviados: 4,
    quadrosEsperados: 4,
    lacunasInjetadas: [{ inicioMs: BASE + 10_500, fimMs: BASE + 11_500 }],
    videosFechados: ["seg-1", "seg-2"],
    errosHttp: 0,
    crescimentoRssMaxMb: 80,
    duracaoMs: 120_000,
    acelerado: false,
  };
}

describe("avaliarSoak - telemetria de monitoramento", () => {
  it("aprova uma execução completa e consistente", () => {
    const resultado = avaliarSoak(entradaBase());

    expect(resultado.veredito).toBe("APROVADO");
    expect(resultado.problemas).toEqual([]);
    expect(resultado.metricas).toMatchObject({
      duracaoMs: 120_000,
      quadrosContabilizados: 4,
      quadrosEsperados: 4,
      totalSegmentos: 2,
      totalLacunas: 1,
      rssInicialBytes: 100 * MB,
      rssFinalBytes: 110 * MB,
      rssMaxBytes: 110 * MB,
      crescimentoRssMb: 10,
      picoCpuPercent: 25,
      bytesVideoFinal: 2 * 1024,
      bytesPorHora: 61_440,
      segmentosPorMinuto: 1,
    });
  });

  it("reprova segmentos sobrepostos", () => {
    const entrada = entradaBase();
    entrada.segmentos[1] = segmento("seg-2", 29_000, 60_000, 2);

    const resultado = avaliarSoak(entrada);

    expect(resultado.veredito).toBe("REPROVADO");
    expect(resultado.problemas.join(" ")).toMatch(/Sobreposição/);
  });

  it("reprova id de segmento duplicado", () => {
    const entrada = entradaBase();
    entrada.segmentos[1] = segmento("seg-1", 30_000, 60_000, 2);

    const resultado = avaliarSoak(entrada);

    expect(resultado.veredito).toBe("REPROVADO");
    expect(resultado.problemas.join(" ")).toMatch(/duplicado/i);
  });

  it("reprova perda de quadro com os números observados e esperados", () => {
    const entrada = entradaBase();
    entrada.quadrosEsperados = 5;

    const resultado = avaliarSoak(entrada);

    expect(resultado.veredito).toBe("REPROVADO");
    expect(resultado.problemas.join(" ")).toMatch(/4.*5/);
    expect(resultado.metricas.quadrosContabilizados).toBe(4);
  });

  it("reprova lacuna injetada sem registro temporal", () => {
    const entrada = entradaBase();
    entrada.lacunasInjetadas = [{ inicioMs: BASE + 70_000, fimMs: BASE + 72_000 }];

    const resultado = avaliarSoak(entrada);

    expect(resultado.veredito).toBe("REPROVADO");
    expect(resultado.problemas.join(" ")).toMatch(/Lacuna injetada #1/);
  });

  it("reprova segmento fechado sem bytes de vídeo", () => {
    const entrada = entradaBase();
    entrada.videosFechados = ["seg-1"];

    const resultado = avaliarSoak(entrada);

    expect(resultado.veredito).toBe("REPROVADO");
    expect(resultado.problemas.join(" ")).toMatch(/seg-2/);
  });

  it("reprova qualquer erro HTTP", () => {
    const entrada = entradaBase();
    entrada.errosHttp = 2;

    const resultado = avaliarSoak(entrada);

    expect(resultado.veredito).toBe("REPROVADO");
    expect(resultado.problemas.join(" ")).toMatch(/2 erro\(s\) HTTP/);
  });

  it("reprova crescimento de RSS acima do limite", () => {
    const entrada = entradaBase();
    entrada.amostras[1] = amostra({
      emMs: 120_000,
      rssBytes: 200 * MB,
      usoPercentualCpu: 25,
    });

    const resultado = avaliarSoak(entrada);

    expect(resultado.veredito).toBe("REPROVADO");
    expect(resultado.problemas.join(" ")).toMatch(/RSS 100\.00 MB/);
    expect(resultado.metricas.crescimentoRssMb).toBe(100);
  });

  it("marca como inconclusivo o modo acelerado, a janela curta e a ausência de amostras", () => {
    const acelerado = entradaBase();
    acelerado.acelerado = true;
    acelerado.amostras = acelerado.amostras.map((valor) => ({
      ...valor,
      usoPercentualCpu: null,
    }));

    const resultadoAcelerado = avaliarSoak(acelerado);
    const notas = resultadoAcelerado.notas.join(" ");

    expect(resultadoAcelerado.veredito).toBe("INCONCLUSIVO");
    expect(resultadoAcelerado.metricas.picoCpuPercent).toBeNull();
    expect(notas).toMatch(/acelerado/);
    expect(notas).toMatch(/diagnóstica/i);

    const curto = entradaBase();
    curto.duracaoMs = 30_000;
    expect(avaliarSoak(curto).veredito).toBe("INCONCLUSIVO");

    const semAmostras = entradaBase();
    semAmostras.amostras = [];
    expect(avaliarSoak(semAmostras).veredito).toBe("INCONCLUSIVO");
  });

  it("dá precedência a REPROVADO sobre INCONCLUSIVO", () => {
    const entrada = entradaBase();
    entrada.acelerado = true;
    entrada.duracaoMs = 30_000;
    entrada.errosHttp = 1;

    const resultado = avaliarSoak(entrada);

    expect(resultado.veredito).toBe("REPROVADO");
    expect(resultado.notas.join(" ")).toMatch(/INCONCLUSIVO/);
  });

  it("não exige bytes quando exigirVideos é false", () => {
    const entrada = entradaBase();
    entrada.videosFechados = [];
    entrada.exigirVideos = false;

    const resultado = avaliarSoak(entrada);

    expect(resultado.veredito).toBe("APROVADO");
    expect(resultado.problemas).toEqual([]);
  });
});
