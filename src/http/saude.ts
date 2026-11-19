/**
 * Medicao de saude do processo e rota /api/health.
 *
 * Extraido de `src/server.ts` na refatoracao de responsabilidades.
 */
import { ServerResponse } from "node:http";
import os from "node:os";
import { ServicoMonitoramento } from "../monitoramento/servico-monitoramento";
import { ArmazenadorVideos } from "../persistence/armazenador-videos";

import { sendJson } from "./base";
import { consultarVisao } from "./rotas-visao";
import { ServerConfig } from "./servidor";

/** Amostra anterior de CPU; a primeira chamada nao tem delta para calcular uso. */
export let amostraCpuAnterior: { uso: NodeJS.CpuUsage; uptimeMs: number } | null = null;

export interface InfoSistemaSaude {
  cpu: {
    userMs: number;
    systemMs: number;
    /** Uso do processo desde a amostra anterior; null na primeira consulta. */
    usoPercentual: number | null;
    nucleos: number;
  };
  ram: {
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    sistemaTotalBytes: number;
    sistemaLivreBytes: number;
  };
  gpu: {
    /** Nunca inventado: sem API real no servidor, fica null. */
    utilizacaoPercentual: null;
    motivo: string;
  };
  armazenamento: {
    arquivos: number;
    bytesTotal: number;
    /** Estimativa a partir dos arquivos gravados; null sem amostra temporal. */
    bytesPorHora: number | null;
  };
}

/** Mede recursos do processo e do sistema sem depender de biblioteca externa. */
export async function medirSistemaSaude(
  armazenador: ArmazenadorVideos
): Promise<InfoSistemaSaude> {
  const uso = process.cpuUsage();
  const uptimeMs = process.uptime() * 1000;
  let usoPercentual: number | null = null;
  if (amostraCpuAnterior) {
    const cpuDeltaUs =
      uso.user - amostraCpuAnterior.uso.user + (uso.system - amostraCpuAnterior.uso.system);
    const tempoDeltaMs = uptimeMs - amostraCpuAnterior.uptimeMs;
    if (tempoDeltaMs > 0) usoPercentual = (cpuDeltaUs / (tempoDeltaMs * 1000)) * 100;
  }
  amostraCpuAnterior = { uso, uptimeMs };

  const memoria = process.memoryUsage();
  const arquivos = await armazenador.listar();
  const bytesTotal = arquivos.reduce((total, arquivo) => total + arquivo.bytes, 0);
  const criados = arquivos.map((arquivo) => arquivo.criadoEmMs);
  const inicio = criados.length > 0 ? Math.min(...criados) : 0;
  const fim = criados.length > 0 ? Math.max(...criados) : 0;
  const horas = (fim - inicio) / 3_600_000;
  const bytesPorHora = arquivos.length > 1 && horas > 0 ? bytesTotal / horas : null;

  return {
    cpu: {
      userMs: uso.user / 1000,
      systemMs: uso.system / 1000,
      usoPercentual,
      nucleos: os.cpus().length,
    },
    ram: {
      rssBytes: memoria.rss,
      heapUsedBytes: memoria.heapUsed,
      heapTotalBytes: memoria.heapTotal,
      sistemaTotalBytes: os.totalmem(),
      sistemaLivreBytes: os.freemem(),
    },
    gpu: {
      utilizacaoPercentual: null,
      motivo: "indisponivel: nenhuma API de utilizacao de GPU no servidor",
    },
    armazenamento: { arquivos: arquivos.length, bytesTotal, bytesPorHora },
  };
}

export async function handleHealth(
  res: ServerResponse,
  config: ServerConfig,
  monitoramento: ServicoMonitoramento,
  armazenador: ArmazenadorVideos
): Promise<void> {
  const visao = await consultarVisao(config.backendUrl);
  const sistema = await medirSistemaSaude(armazenador);
  const sessao = monitoramento.sessaoAtual();
  const segmentos = sessao ? await monitoramento.segmentosDaSessao(sessao.sessaoId) : [];
  sendJson(res, 200, {
    ok: true,
    visao,
    sistema,
    monitoramento: {
      sessaoId: sessao?.sessaoId ?? null,
      estado: sessao?.estado ?? null,
      segmentos: segmentos.length,
      quadros: segmentos.reduce((total, segmento) => total + segmento.quadros, 0),
      lacunas: segmentos.reduce((total, segmento) => total + segmento.lacunas.length, 0),
    },
  });
}
