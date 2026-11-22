import http from "node:http";
import { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { ServicoMonitoramento } from "../../monitoramento/servico-monitoramento";
import { ArmazenadorVideos } from "../../persistence/armazenador-videos";
import { ServicoCena } from "../../monitoramento/servico-cena";
import { ServicoAtencao } from "../../monitoramento/servico-atencao";
import { env } from "../../env";
import { politicaAutenticacao } from "../seguranca";
import { LOG_FILE, LOG_MAX_BYTES, PUBLIC_DIR, SNAP_DIR, VIDEO_UPLOAD_MAX_BYTES, definirArquivoOperacionalAtivo, origensPermitidas } from "../base";
import type { ServerConfig } from "./tipos";
import { tratarRequisicao } from "./roteador";

export function createServer(config: ServerConfig = {}): http.Server {
  const logFile = config.logFile ?? LOG_FILE;
  const snapDir = config.snapDir ?? SNAP_DIR;
  const publicDir = config.publicDir ?? PUBLIC_DIR;
  const eventosFile = config.eventosFile ?? path.join(path.dirname(logFile), "eventos.jsonl");
  const eventosTemporaisFile =
    config.eventosTemporaisFile ?? path.join(path.dirname(logFile), "eventos-temporais.jsonl");
  const operacionalFile =
    config.operacionalFile ?? path.join(path.dirname(logFile), "operacional.jsonl");
  definirArquivoOperacionalAtivo(operacionalFile);
  const ciclosFile = config.ciclosFile ?? path.join(path.dirname(logFile), "ciclos.jsonl");
  const monitoramentoSessoesFile =
    config.monitoramentoSessoesFile ??
    path.join(path.dirname(logFile), "monitoramento-sessoes.jsonl");
  const monitoramentoSegmentosFile =
    config.monitoramentoSegmentosFile ??
    path.join(path.dirname(logFile), "monitoramento-segmentos.jsonl");
  const auditoriaFile = config.auditoriaFile ?? path.join(path.dirname(logFile), "auditoria.jsonl");
  const monitoramento = new ServicoMonitoramento({
    sessoesFile: monitoramentoSessoesFile,
    segmentosFile: monitoramentoSegmentosFile,
    maxBytes: LOG_MAX_BYTES,
  });
  const armazenadorVideos =
    config.armazenadorVideos ??
    new ArmazenadorVideos({
      dir: config.videosDir ?? path.join(path.dirname(logFile), "videos"),
      maxBytesPorArquivo: config.videoMaxBytes ?? VIDEO_UPLOAD_MAX_BYTES,
      // `createServer` é usado por testes e integrações: sem configuração
      // explícita, preserva o comportamento sem expiração. O CLI (`src/server.ts`)
      // passa a política habilitada por padrão (30 dias/500 arquivos/5 GB).
      retencaoMs: config.videoRetencaoMs ?? 0,
      maxArquivos: config.videoMaxArquivos ?? 0,
      maxBytesTotais: config.videoMaxBytesTotais ?? 0,
      preservarSegmentoIds: config.videoPreservarSegmentoIds ?? [],
    });
  const cena = new ServicoCena({
    referenciasFile:
      config.cenaReferenciasFile ?? path.join(path.dirname(logFile), "cena-referencias.jsonl"),
    mudancasFile:
      config.cenaMudancasFile ?? path.join(path.dirname(logFile), "cena-mudancas.jsonl"),
    maxBytes: LOG_MAX_BYTES,
  });
  const atencao = new ServicoAtencao({
    arquivo: config.atencaoFile ?? path.join(path.dirname(logFile), "atencao-seguranca.jsonl"),
    maxBytes: LOG_MAX_BYTES,
  });
  const permitidas = origensPermitidas(env.NEURO_ALLOWED_ORIGINS);

  return http.createServer((req: IncomingMessage, res: ServerResponse) => {
    tratarRequisicao(req, res, {
      config,
      logFile,
      snapDir,
      publicDir,
      eventosFile,
      eventosTemporaisFile,
      operacionalFile,
      auditoriaFile,
      ciclosFile,
      autenticacao: config.autenticacao ?? politicaAutenticacao(),
      monitoramento,
      armazenadorVideos,
      cena,
      atencao,
      permitidas,
    });
  });
}
