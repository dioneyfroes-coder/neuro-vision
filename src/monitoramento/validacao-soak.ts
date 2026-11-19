/**
 * Avaliação determinística do soak test de monitoramento (Fase 7).
 *
 * Módulo **puro**: não lê arquivos, não consulta relógio e não faz requisições.
 * Recebe telemetria já coletada pelo harness (`scripts/soak-monitoramento.mjs`)
 * e devolve um veredito com problemas explícitos. Assim a mesma entrada sempre
 * produz o mesmo resultado, em teste ou em produção.
 *
 * As lacunas injetadas e as lacunas dos segmentos precisam estar na **mesma
 * linha do tempo** (epoch ms). O harness converte as janelas relativas ao
 * início da sessão antes de chamar `avaliarSoak`.
 */
import type { VideoSegment } from "../domain/monitoramento";

/** Uma leitura de `/api/health` (ou fonte equivalente) em determinado instante. */
export interface AmostraTelemetria {
  emMs: number;
  usoPercentualCpu: number | null;
  rssBytes: number;
  heapBytes: number;
  bytesVideo: number;
  quadros: number;
  segmentos: number;
  lacunas: number;
}

/** Janela sem quadros deliberadamente simulada pelo harness, relativa ao início. */
export interface LacunaInjetada {
  inicioMs: number;
  fimMs: number;
}

export interface EntradaAvaliacaoSoak {
  amostras: AmostraTelemetria[];
  segmentos: VideoSegment[];
  quadrosEnviados: number;
  quadrosEsperados: number;
  lacunasInjetadas: LacunaInjetada[];
  videosFechados: string[];
  errosHttp: number;
  crescimentoRssMaxMb: number;
  duracaoMs: number;
  acelerado: boolean;
  /** `false` desativa a exigência de bytes (modo `--sem-videos`). */
  exigirVideos?: boolean;
}

export interface ResultadoAvaliacaoSoak {
  veredito: "APROVADO" | "REPROVADO" | "INCONCLUSIVO";
  problemas: string[];
  notas: string[];
  metricas: {
    duracaoMs: number;
    quadrosContabilizados: number;
    quadrosEsperados: number;
    totalSegmentos: number;
    totalLacunas: number;
    rssInicialBytes: number;
    rssFinalBytes: number;
    rssMaxBytes: number;
    crescimentoRssMb: number;
    picoCpuPercent: number | null;
    bytesVideoFinal: number;
    bytesPorHora: number;
    segmentosPorMinuto: number;
  };
}

const BYTES_POR_MB = 1024 * 1024;

/**
 * Avalia a telemetria do soak. Problemas têm precedência sobre inconclusivo:
 * uma falha observada reprova mesmo quando a janela é curta ou acelerada.
 */
export function avaliarSoak(entrada: EntradaAvaliacaoSoak): ResultadoAvaliacaoSoak {
  const problemas: string[] = [];
  const notas: string[] = [];

  const segmentos = [...entrada.segmentos].sort(
    (a, b) => a.inicioMs - b.inicioMs || a.sequencia - b.sequencia
  );

  const vistos = new Set<string>();
  for (const segmento of segmentos) {
    if (vistos.has(segmento.segmentoId)) {
      problemas.push(`Segmento duplicado: ${segmento.segmentoId}`);
    }
    vistos.add(segmento.segmentoId);
  }
  for (let i = 1; i < segmentos.length; i += 1) {
    const anterior = segmentos[i - 1];
    const proximo = segmentos[i];
    if (proximo.inicioMs < anterior.fimMs) {
      problemas.push(
        `Sobreposição de segmentos: ${anterior.segmentoId} termina em ${anterior.fimMs}, ` +
          `${proximo.segmentoId} começa em ${proximo.inicioMs}`
      );
    }
  }

  const quadrosContabilizados = segmentos.reduce((total, segmento) => total + segmento.quadros, 0);
  if (quadrosContabilizados !== entrada.quadrosEsperados) {
    problemas.push(
      `Quadros contabilizados (${quadrosContabilizados}) divergem dos esperados ` +
        `(${entrada.quadrosEsperados})`
    );
  }

  entrada.lacunasInjetadas.forEach((lacuna, indice) => {
    const explicada = segmentos.some((segmento) =>
      segmento.lacunas.some(
        (registrada) =>
          registrada.duracaoMs > 0 &&
          registrada.inicioMs < lacuna.fimMs &&
          registrada.fimMs > lacuna.inicioMs
      )
    );
    if (!explicada) {
      problemas.push(
        `Lacuna injetada #${indice + 1} [${lacuna.inicioMs}, ${lacuna.fimMs}] ` +
          "sem registro de duração positiva com interseção temporal"
      );
    }
  });

  if (entrada.exigirVideos !== false) {
    const fechados = new Set(entrada.videosFechados);
    for (const segmento of segmentos) {
      if (segmento.estado !== "gravando" && !fechados.has(segmento.segmentoId)) {
        problemas.push(`Vídeo do segmento ${segmento.segmentoId} não foi enviado/fechado`);
      }
    }
  }

  if (entrada.errosHttp > 0) {
    problemas.push(`${entrada.errosHttp} erro(s) HTTP durante o soak`);
  }

  const rss = entrada.amostras
    .map((amostra) => amostra.rssBytes)
    .filter((valor) => Number.isFinite(valor));
  const rssInicialBytes = rss.length > 0 ? rss[0] : 0;
  const rssFinalBytes = rss.length > 0 ? rss[rss.length - 1] : 0;
  const rssMaxBytes = rss.length > 0 ? Math.max(...rss) : 0;
  const rssMinBytes = rss.length > 0 ? Math.min(...rss) : 0;
  const crescimentoRssMb = (rssMaxBytes - rssMinBytes) / BYTES_POR_MB;

  if (entrada.acelerado) {
    notas.push(
      "Modo acelerado: a medição de memória é diagnóstica; a janela curta não sustenta aceite de RSS."
    );
  } else if (crescimentoRssMb > entrada.crescimentoRssMaxMb) {
    problemas.push(
      `Crescimento de RSS ${crescimentoRssMb.toFixed(2)} MB excede o limite de ` +
        `${entrada.crescimentoRssMaxMb} MB`
    );
  }

  const cpus = entrada.amostras
    .map((amostra) => amostra.usoPercentualCpu)
    .filter((valor): valor is number => typeof valor === "number" && Number.isFinite(valor));
  const picoCpuPercent = cpus.length > 0 ? Math.max(...cpus) : null;

  const bytesVideoFinal =
    entrada.amostras.length > 0
      ? entrada.amostras[entrada.amostras.length - 1].bytesVideo
      : 0;
  const duracaoHoras = entrada.duracaoMs > 0 ? entrada.duracaoMs / 3_600_000 : 0;
  const duracaoMinutos = entrada.duracaoMs > 0 ? entrada.duracaoMs / 60_000 : 0;
  const totalSegmentos = segmentos.length;
  const totalLacunas = segmentos.reduce((total, segmento) => total + segmento.lacunas.length, 0);

  const motivosInconclusivo: string[] = [];
  if (entrada.amostras.length === 0) motivosInconclusivo.push("nenhuma amostra de telemetria");
  if (entrada.acelerado) motivosInconclusivo.push("tempo simulado acelerado");
  if (entrada.duracaoMs < 60_000) motivosInconclusivo.push("duração inferior a 60 s");
  const inconclusivo = motivosInconclusivo.length > 0;
  if (inconclusivo) {
    notas.push(`INCONCLUSIVO por ${motivosInconclusivo.join("; ")}.`);
  }

  const veredito: ResultadoAvaliacaoSoak["veredito"] =
    problemas.length > 0 ? "REPROVADO" : inconclusivo ? "INCONCLUSIVO" : "APROVADO";

  return {
    veredito,
    problemas,
    notas,
    metricas: {
      duracaoMs: entrada.duracaoMs,
      quadrosContabilizados,
      quadrosEsperados: entrada.quadrosEsperados,
      totalSegmentos,
      totalLacunas,
      rssInicialBytes,
      rssFinalBytes,
      rssMaxBytes,
      crescimentoRssMb,
      picoCpuPercent,
      bytesVideoFinal,
      bytesPorHora: duracaoHoras > 0 ? bytesVideoFinal / duracaoHoras : 0,
      segmentosPorMinuto: duracaoMinutos > 0 ? totalSegmentos / duracaoMinutos : 0,
    },
  };
}
