/**
 * Fachada publica do servidor HTTP.
 *
 * A implementacao foi dividida por responsabilidade em `src/http/`;
 * este arquivo preserva a API usada por scripts, testes e pelo CLI.
 */
export * from "./http/base";
export * from "./http/validacao";
export * from "./http/persistencia";
export * from "./http/arquivos";
export * from "./http/rotas-memoria";
export * from "./http/rotas-monitoramento";
export * from "./http/rotas-videos";
export * from "./http/rotas-cena";
export * from "./http/rotas-atencao";
export * from "./http/rotas-visao";
export * from "./http/saude";
export * from "./http/servidor";

import path from "node:path";
import { pathToFileURL } from "node:url";
import { env } from "./env";
import { resolverBackend } from "./provedor";
import { ArmazenadorVideos } from "./persistence/armazenador-videos";
import {
  LOG_FILE,
  VIDEO_UPLOAD_MAX_BYTES,
  hostExpostoNaRede,
  logEvent,
  registrarFalha,
} from "./http/base";
import { limparSnapshots } from "./http/persistencia";
import { createServer } from "./http/servidor";

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryUrl) {
  const PORT = env.PORT;
  const HOST = env.HOST;
  const operacionalInicial = path.join(path.dirname(LOG_FILE), "operacional.jsonl");
  if (hostExpostoNaRede(HOST) && !env.NEURO_ALLOW_REMOTE) {
    registrarFalha("error", "bind_remoto_bloqueado", { host: HOST }, operacionalInicial);
    console.error(
      `\n  HOST=${HOST} expoe a interface e a API a rede local, sem autenticacao.\n` +
        `  Use HOST=127.0.0.1 (padrao) ou defina NEURO_ALLOW_REMOTE=1 para assumir o risco.\n` +
        `  Ao expor, restrinja o acesso (firewall/reverse proxy com autenticacao) e limite as origens com NEURO_ALLOWED_ORIGINS.\n`
    );
    process.exit(1);
  }
  if (hostExpostoNaRede(HOST)) {
    registrarFalha("warn", "bind_remoto_habilitado", { host: HOST }, operacionalInicial);
    console.warn(
      `\n  AVISO: HOST=${HOST} expoe a interface e a API a rede local, sem autenticacao.\n` +
        `  Restrinja o acesso (firewall/reverse proxy com autenticacao) e limite as origens com NEURO_ALLOWED_ORIGINS.\n`
    );
  }
  // Limpeza inicial em segundo plano, sem atrasar a subida do servidor.
  limparSnapshots()
    .then((resultado) => {
      if (resultado.removidos > 0) {
        logEvent("info", "snapshots_limpos", {
          removidos: resultado.removidos,
          bytesLiberados: resultado.bytesLiberados,
        });
      }
    })
    .catch((err) =>
      registrarFalha("warn", "limpeza_snapshots_falhou", { erro: (err as Error).message }, operacionalInicial)
    );
  // Retencao de videos tambem na subida: arquivos expirados enquanto o servidor
  // esteve desligado nao podem ficar para sempre so porque a rota nao foi chamada.
  const armazenadorInicial = new ArmazenadorVideos({
    dir: path.join(path.dirname(LOG_FILE), "videos"),
    maxBytesPorArquivo: VIDEO_UPLOAD_MAX_BYTES,
    retencaoMs: env.VIDEO_RETENCAO_MS,
    maxArquivos: env.VIDEO_MAX_ARQUIVOS,
  });
  void armazenadorInicial
    .aplicarRetencao(Date.now())
    .then((removidos) => {
      if (removidos.length > 0) {
        registrarFalha(
          "info",
          "retencao_videos_startup",
          { removidos: removidos.map((arquivo) => arquivo.segmentoId) },
          operacionalInicial
        );
      }
    })
    .catch((err) =>
      registrarFalha("warn", "retencao_videos_falhou", { erro: (err as Error).message }, operacionalInicial)
    );
  // Registra o backend de visao configurado (URL base resolvida).
  const backendUrl = resolverBackend({}).baseUrl;
  logEvent("info", "backend_configurado", { baseUrl: backendUrl });
  console.log(`  Backend de visao: ${backendUrl}`);
  createServer({ armazenadorVideos: armazenadorInicial }).listen(PORT, HOST, () => {
    logEvent("info", "servidor_iniciado", { host: HOST, port: PORT, logFile: LOG_FILE });
    console.log(`\n  Neuro Vision rodando em http://${HOST}:${PORT}`);
    console.log(`  Logs em: ${LOG_FILE}\n`);
  });
}
