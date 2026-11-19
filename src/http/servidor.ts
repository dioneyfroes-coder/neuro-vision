/**
 * Composicao do servidor HTTP e tabela de rotas.
 *
 * Extraido de `src/server.ts` na refatoracao de responsabilidades.
 */
import http from "node:http";
import { IncomingMessage } from "node:http";
import { ServerResponse } from "node:http";
import path from "node:path";
import { ServicoMonitoramento } from "../monitoramento/servico-monitoramento";
import { ArmazenadorVideos } from "../persistence/armazenador-videos";
import { ServicoCena } from "../monitoramento/servico-cena";
import { env } from "../env";

import { serveArquivoOffline, serveModeloNsfw, serveSnapshot, serveStatic } from "./arquivos";
import { LOG_FILE, LOG_MAX_BYTES, MODELOS_DIR, NSFW_DIR, PUBLIC_DIR, SNAP_DIR, VENDOR_DIR, VIDEO_UPLOAD_MAX_BYTES, definirArquivoOperacionalAtivo, origemBloqueada, origensPermitidas } from "./base";
import { handleCompararCena, handleListarMudancasCena, handleObterReferenciaCena, handleReferenciaCena, rotaCenaMonitoramento } from "./rotas-cena";
import { handleCiclos, handleClearCiclos, handleClearEventos, handleClearEventosTemporais, handleClearLogs, handleContexto, handleEventos, handleEventosTemporais, handleListCiclos, handleListEventos, handleListEventosTemporais, handleListLogs, handleLog, handleOperacional } from "./rotas-memoria";
import { handleComandoMonitoramento, handleIniciarMonitoramento, handleListarSegmentosMonitoramento, handleListarSessoesMonitoramento, handleQuadrosMonitoramento, handleSegmentosDaSessaoMonitoramento, rotaSessaoMonitoramento } from "./rotas-monitoramento";
import { handleExcluirVideo, handleExcluirVideosSessao, handleListarVideos, handleObterVideo, handleRetencaoVideos, handleUploadVideo } from "./rotas-videos";
import { handlePreparar, handleVisao } from "./rotas-visao";
import { handleHealth } from "./saude";

export interface ServerConfig {
  logFile?: string;
  snapDir?: string;
  publicDir?: string;
  /** URL base do backend de visao (LM Studio). */
  backendUrl?: string;
  /** Chave de API do backend (LM Studio ignora). */
  apiKey?: string;
  /** Arquivo de eventos estruturados. Padrao: `eventos.jsonl` ao lado do log. */
  eventosFile?: string;
  /**
   * Arquivo da memoria de gestos/posturas (P2.6). Padrao:
   * `eventos-temporais.jsonl` ao lado do log.
   */
  eventosTemporaisFile?: string;
  /** Arquivo de registros operacionais. Padrao: `operacional.jsonl` ao lado do log. */
  operacionalFile?: string;
  /** Arquivo de diagnosticos de ciclo. Padrao: `ciclos.jsonl` ao lado do log. */
  ciclosFile?: string;
  /** Indice de sessoes de monitoramento. Padrao: `monitoramento-sessoes.jsonl`. */
  monitoramentoSessoesFile?: string;
  /** Indice de segmentos de monitoramento. Padrao: `monitoramento-segmentos.jsonl`. */
  monitoramentoSegmentosFile?: string;
  /** Diretorio dos bytes de video. Padrao: `videos/` ao lado do log. */
  videosDir?: string;
  /** Teto por arquivo de video. Padrao: `VIDEO_MAX_BYTES`. */
  videoMaxBytes?: number;
  /** Retencao por idade em ms (0 desativa). Padrao: `VIDEO_RETENCAO_MS`. */
  videoRetencaoMs?: number;
  /** Numero maximo de arquivos (0 desativa). Padrao: `VIDEO_MAX_ARQUIVOS`. */
  videoMaxArquivos?: number;
  /** Instancia pronta (startup aplica retencao antes de abrir a porta). */
  armazenadorVideos?: ArmazenadorVideos;
  /** Indice da referencia do ambiente. Padrao: `cena-referencias.jsonl`. */
  cenaReferenciasFile?: string;
  /** Linha do tempo de mudancas da cena. Padrao: `cena-mudancas.jsonl`. */
  cenaMudancasFile?: string;
  /** Diretorio dos pesos NSFW experimentais. Padrao: `modelos/yolonsfw/` na raiz. */
  nsfwDir?: string;
  /** Diretorio das bibliotecas do modo offline. Padrao: `vendor/` na raiz. */
  vendorDir?: string;
  /** Diretorio dos pesos do modo offline. Padrao: `modelos/` na raiz. */
  modelosDir?: string;
}

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
      retencaoMs: config.videoRetencaoMs ?? env.VIDEO_RETENCAO_MS,
      maxArquivos: config.videoMaxArquivos ?? env.VIDEO_MAX_ARQUIVOS,
    });
  const cena = new ServicoCena({
    referenciasFile:
      config.cenaReferenciasFile ?? path.join(path.dirname(logFile), "cena-referencias.jsonl"),
    mudancasFile:
      config.cenaMudancasFile ?? path.join(path.dirname(logFile), "cena-mudancas.jsonl"),
    maxBytes: LOG_MAX_BYTES,
  });
  const permitidas = origensPermitidas(env.NEURO_ALLOWED_ORIGINS);

  return http.createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "/";
    // Isolamento entre origens (COOP/COEP): habilita SharedArrayBuffer e, com
    // ele, o WASM multithread do ONNX Runtime (ate 4 threads por worker -
    // ver `public/desempenho.ts`). `credentialless` mantem o fallback de CDN
    // funcionando (jsdelivr/Hugging Face respondem CORS) sem exigir CORP em
    // cada recurso externo.
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
    if (origemBloqueada(req.headers.origin, req.headers.host, permitidas)) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Origem nao permitida");
      return;
    }
    const pathname = url.split("?")[0];
    if (req.method === "POST" && url === "/api/log") {
      void handleLog(req, res, logFile, snapDir, eventosFile);
      return;
    }
    if (req.method === "POST" && url === "/api/visao") {
      void handleVisao(req, res, { ...config, eventosFile });
      return;
    }
    if (req.method === "POST" && url === "/api/eventos") {
      void handleEventos(req, res, eventosFile, snapDir, logFile);
      return;
    }
    if (req.method === "GET" && pathname === "/api/eventos") {
      void handleListEventos(req, res, eventosFile, monitoramento);
      return;
    }
    if (req.method === "DELETE" && pathname === "/api/eventos") {
      void handleClearEventos(res, eventosFile, snapDir, logFile);
      return;
    }
    if (req.method === "POST" && pathname === "/api/eventos-temporais") {
      void handleEventosTemporais(req, res, eventosTemporaisFile);
      return;
    }
    if (req.method === "GET" && pathname === "/api/eventos-temporais") {
      void handleListEventosTemporais(req, res, eventosTemporaisFile, monitoramento);
      return;
    }
    if (req.method === "DELETE" && pathname === "/api/eventos-temporais") {
      void handleClearEventosTemporais(res, eventosTemporaisFile);
      return;
    }
    if (req.method === "POST" && url === "/api/operacional") {
      void handleOperacional(req, res, operacionalFile);
      return;
    }
    if (req.method === "POST" && url === "/api/ciclos") {
      void handleCiclos(req, res, ciclosFile);
      return;
    }
    if (req.method === "GET" && pathname === "/api/ciclos") {
      void handleListCiclos(req, res, ciclosFile);
      return;
    }
    if (req.method === "DELETE" && pathname === "/api/ciclos") {
      void handleClearCiclos(res, ciclosFile);
      return;
    }
    if (pathname === "/api/monitoramento/sessoes") {
      if (req.method === "POST") {
        void handleIniciarMonitoramento(req, res, monitoramento);
        return;
      }
      if (req.method === "GET") {
        void handleListarSessoesMonitoramento(req, res, monitoramento);
        return;
      }
    }
    if (req.method === "POST" && pathname === "/api/monitoramento/quadros") {
      void handleQuadrosMonitoramento(req, res, monitoramento);
      return;
    }
    if (req.method === "GET" && pathname === "/api/monitoramento/segmentos") {
      void handleListarSegmentosMonitoramento(req, res, monitoramento);
      return;
    }
    if (pathname === "/api/monitoramento/videos") {
      if (req.method === "GET") {
        void handleListarVideos(req, res, armazenadorVideos);
        return;
      }
      if (req.method === "DELETE") {
        void handleExcluirVideosSessao(req, res, armazenadorVideos);
        return;
      }
      res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Metodo nao permitido");
      return;
    }
    if (req.method === "POST" && pathname === "/api/monitoramento/videos/retencao") {
      void handleRetencaoVideos(req, res, armazenadorVideos);
      return;
    }
    const rotaVideo = /^\/api\/monitoramento\/videos\/([^/]+)$/.exec(pathname);
    if (rotaVideo) {
      const segmentoId = decodeURIComponent(rotaVideo[1]);
      if (req.method === "POST") {
        void handleUploadVideo(req, res, monitoramento, armazenadorVideos, segmentoId);
        return;
      }
      if (req.method === "GET") {
        void handleObterVideo(res, armazenadorVideos, segmentoId);
        return;
      }
      if (req.method === "DELETE") {
        void handleExcluirVideo(res, armazenadorVideos, segmentoId);
        return;
      }
      res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Metodo nao permitido");
      return;
    }
    const rotaCena = rotaCenaMonitoramento(pathname);
    if (rotaCena) {
      if (rotaCena.acao === "referencia") {
        if (req.method === "POST") {
          void handleReferenciaCena(req, res, cena, monitoramento, rotaCena.sessaoId);
          return;
        }
        if (req.method === "GET") {
          void handleObterReferenciaCena(res, cena, monitoramento, rotaCena.sessaoId);
          return;
        }
      } else if (rotaCena.acao === "comparar") {
        if (req.method === "POST") {
          void handleCompararCena(req, res, cena, monitoramento, rotaCena.sessaoId);
          return;
        }
      } else if (req.method === "GET") {
        void handleListarMudancasCena(req, res, cena, monitoramento, rotaCena.sessaoId);
        return;
      }
      res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Metodo nao permitido");
      return;
    }
    const rotaSessaoMonitoramentoAtual = rotaSessaoMonitoramento(pathname);
    if (rotaSessaoMonitoramentoAtual) {
      if (rotaSessaoMonitoramentoAtual.acao === "segmentos") {
        if (req.method === "GET") {
          void handleSegmentosDaSessaoMonitoramento(
            req,
            res,
            monitoramento,
            rotaSessaoMonitoramentoAtual.sessaoId
          );
          return;
        }
      } else if (req.method === "POST") {
        void handleComandoMonitoramento(
          req,
          res,
          monitoramento,
          rotaSessaoMonitoramentoAtual.sessaoId,
          rotaSessaoMonitoramentoAtual.acao
        );
        return;
      }
      res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Metodo nao permitido");
      return;
    }
    if (req.method === "GET" && pathname === "/api/contexto") {
      void handleContexto(req, res, logFile, eventosFile);
      return;
    }
    if (req.method === "GET" && pathname === "/api/visao/preparar") {
      const modelo = new URL(req.url ?? "/", "http://localhost").searchParams.get("modelo");
      void handlePreparar(res, config, modelo ?? undefined);
      return;
    }
    if (req.method === "GET" && pathname === "/api/logs") {
      void handleListLogs(req, res, logFile, monitoramento);
      return;
    }
    if (req.method === "DELETE" && pathname === "/api/logs") {
      void handleClearLogs(res, logFile, snapDir, eventosFile, ciclosFile, eventosTemporaisFile);
      return;
    }
    if (req.method === "GET" && pathname === "/api/health") {
      void handleHealth(res, config, monitoramento, armazenadorVideos);
      return;
    }
    if (req.method === "GET" && pathname.startsWith("/snapshots/")) {
      serveSnapshot(req, res, snapDir);
      return;
    }
    if (req.method === "GET" && pathname.startsWith("/yolonsfw/")) {
      serveModeloNsfw(req, res, config.nsfwDir ?? NSFW_DIR);
      return;
    }
    if ((req.method === "GET" || req.method === "HEAD") && pathname.startsWith("/vendor/")) {
      serveArquivoOffline(
        req,
        res,
        config.vendorDir ?? VENDOR_DIR,
        /^\/vendor\/?/,
        /\.(mjs|js|wasm)$/
      );
      return;
    }
    if ((req.method === "GET" || req.method === "HEAD") && pathname.startsWith("/modelos/")) {
      serveArquivoOffline(
        req,
        res,
        config.modelosDir ?? MODELOS_DIR,
        /^\/modelos\/?/,
        /\.(onnx|task|json)$/
      );
      return;
    }
    if (req.method === "GET") {
      serveStatic(req, res, publicDir);
      return;
    }
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Metodo nao permitido");
  });
}
