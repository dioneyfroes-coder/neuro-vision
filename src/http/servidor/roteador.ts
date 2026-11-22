import type { IncomingMessage, ServerResponse } from "node:http";
import type { ArmazenadorVideos } from "../../persistence/armazenador-videos";
import type { ServicoMonitoramento } from "../../monitoramento/servico-monitoramento";
import type { ServicoCena } from "../../monitoramento/servico-cena";
import type { ServicoAtencao } from "../../monitoramento/servico-atencao";
import { MODELOS_DIR, NSFW_DIR, VENDOR_DIR, origemBloqueada } from "../base";
import { serveArquivoOffline, serveModeloNsfw, serveSnapshot, serveStatic } from "../arquivos";
import { handleCompararCena, handleListarMudancasCena, handleObterReferenciaCena, handleReferenciaCena, handleRevisarMudancaCena, rotaCenaMonitoramento } from "../rotas-cena";
import { handleGravarAtencao, handleListarAtencao } from "../rotas-atencao";
import { handleCiclos, handleClearCiclos, handleClearEventos, handleClearEventosTemporais, handleClearLogs, handleContexto, handleCorrigirEventoTemporal, handleEventos, handleEventosTemporais, handleExportarEventos, handleListCiclos, handleListEventos, handleListEventosTemporais, handleListLogs, handleLog, handleOperacional } from "../rotas-memoria";
import { handleComandoMonitoramento, handleIniciarMonitoramento, handleListarSegmentosMonitoramento, handleListarSessoesMonitoramento, handleQuadrosMonitoramento, handleSegmentosDaSessaoMonitoramento, rotaSessaoMonitoramento } from "../rotas-monitoramento";
import { handleExcluirVideo, handleExcluirVideosSessao, handleListarVideos, handleObterVideo, handleRetencaoVideos, handleUploadVideo } from "../rotas-videos";
import { handlePreparar, handleVisao } from "../rotas-visao";
import { handleHealth } from "../saude";
import type { ServerConfig } from "./tipos";

export interface DependenciasServidor {
  config: ServerConfig;
  logFile: string;
  snapDir: string;
  publicDir: string;
  eventosFile: string;
  eventosTemporaisFile: string;
  operacionalFile: string;
  ciclosFile: string;
  monitoramento: ServicoMonitoramento;
  armazenadorVideos: ArmazenadorVideos;
  cena: ServicoCena;
  atencao: ServicoAtencao;
  permitidas: string[];
}

export function tratarRequisicao(req: IncomingMessage, res: ServerResponse, deps: DependenciasServidor): void {
  const { config, logFile, snapDir, publicDir, eventosFile, eventosTemporaisFile, operacionalFile, ciclosFile, monitoramento, armazenadorVideos, cena, atencao, permitidas } = deps;
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
      if (req.method === "GET" && pathname === "/api/eventos/exportar") {
        void handleExportarEventos(req, res, eventosFile, eventosTemporaisFile);
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
      if (
        req.method === "POST" &&
        /^\/api\/eventos-temporais\/[^/]+\/corrigir$/.test(pathname)
      ) {
        void handleCorrigirEventoTemporal(req, res, eventosTemporaisFile);
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
      if (pathname === "/api/monitoramento/seguranca/atencao") {
        if (req.method === "POST") {
          void handleGravarAtencao(req, res, atencao, monitoramento);
          return;
        }
        if (req.method === "GET") {
          void handleListarAtencao(req, res, atencao);
          return;
        }
        res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Metodo nao permitido");
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
          void handleObterVideo(req, res, armazenadorVideos, segmentoId);
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
        } else if (rotaCena.acao === "confirmar") {
          if (req.method === "POST") {
            void handleRevisarMudancaCena(req, res, cena, monitoramento, rotaCena.sessaoId);
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
}
