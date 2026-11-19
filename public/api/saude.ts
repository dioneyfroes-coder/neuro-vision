import type { InfoVisao } from "./http";
import { ErroPercepcao } from "../../src/erros";

export async function saudeVisao(): Promise<InfoVisao | null> {
  let resposta: Response;
  try {
    resposta = await fetch("/api/health");
  } catch (err) {
    throw new ErroPercepcao("visao", "Backend de visao: servidor indisponivel", { cause: err });
  }
  const dados = (await resposta.json()) as { visao?: InfoVisao };
  return dados.visao ?? null;
}

export interface InfoSistema {
  cpu: {
    userMs: number;
    systemMs: number;
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
  gpu: { utilizacaoPercentual: number | null; motivo: string };
  armazenamento: { arquivos: number; bytesTotal: number; bytesPorHora: number | null };
}

export interface RespostaSaude {
  ok: boolean;
  visao: InfoVisao | null;
  sistema: InfoSistema | null;
  monitoramento: {
    sessaoId: string | null;
    estado: string | null;
    segmentos: number;
    quadros: number;
    lacunas: number;
  } | null;
}

export async function saudeSistema(): Promise<RespostaSaude> {
  let resposta: Response;
  try {
    resposta = await fetch("/api/health");
  } catch (err) {
    throw new ErroPercepcao("visao", "Servidor indisponivel", { cause: err });
  }
  const dados = (await resposta.json().catch(() => null)) as Partial<RespostaSaude> | null;
  return {
    ok: dados?.ok ?? false,
    visao: dados?.visao ?? null,
    sistema: dados?.sistema ?? null,
    monitoramento: dados?.monitoramento ?? null,
  };
}