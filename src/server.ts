/**
 * Fachada publica do servidor HTTP.
 *
 * A implementacao foi dividida por responsabilidade em `src/http/`;
 * este arquivo preserva a API usada por scripts, testes e pelo CLI.
 */
export * from "./domain/auditoria";
export * from "./domain/retencao-videos";
export * from "./http/base";
export * from "./http/validacao";
export * from "./http/persistencia";
export * from "./http/arquivos";
export * from "./http/auditoria";
export * from "./http/seguranca";
export * from "./http/rotas-autenticacao";
export * from "./http/rotas-memoria";
export * from "./http/rotas-monitoramento";
export * from "./http/rotas-videos";
export * from "./http/rotas-cena";
export * from "./http/rotas-atencao";
export * from "./http/rotas-visao";
export * from "./http/saude";
export * from "./http/servidor";
export * from "./persistence/repositorio-auditoria";
export * from "./persistence/repositorio-monitoramento";
export * from "./persistence/armazenador-videos";
export * from "./persistence/criptografia-video";
export * from "./monitoramento/recuperacao-monitoramento";
export * from "./monitoramento/aplicar-recuperacao";

import path from "node:path";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { env } from "./env";
import { resolverBackend } from "./provedor";
import { ArmazenadorVideos } from "./persistence/armazenador-videos";
import { criarCifradorVideo, interpretarChaveVideo, type CifradorVideo } from "./persistence/criptografia-video";
import { aplicarRecuperacaoMonitoramento } from "./monitoramento/aplicar-recuperacao";
import { criarAuditar } from "./http/auditoria";
import { politicaAutenticacao } from "./http/seguranca";
import {
  LOG_FILE,
  MONITORAMENTO_SEGMENTOS_FILE,
  MONITORAMENTO_SESSOES_FILE,
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
  const auditoriaInicial = path.join(path.dirname(LOG_FILE), "auditoria.jsonl");
  const autenticacao = politicaAutenticacao();
  const descricaoAcesso = autenticacao.obrigatoria
    ? "com autenticacao por token (NEURO_API_TOKEN)"
    : "sem autenticacao embutida";

  if (hostExpostoNaRede(HOST) && !env.NEURO_ALLOW_REMOTE) {
    registrarFalha("error", "bind_remoto_bloqueado", { host: HOST }, operacionalInicial);
    console.error(
      `\n  HOST=${HOST} expoe a interface e a API a rede local (${descricaoAcesso}).\n` +
        `  Use HOST=127.0.0.1 (padrao) ou defina NEURO_ALLOW_REMOTE=1 para assumir o risco.\n` +
        `  Mesmo com autenticacao, restrinja o acesso (firewall/reverse proxy) e limite as origens com NEURO_ALLOWED_ORIGINS.\n`
    );
    process.exit(1);
  }
  if (hostExpostoNaRede(HOST)) {
    registrarFalha(
      "warn",
      "bind_remoto_habilitado",
      { host: HOST, autenticacao: autenticacao.obrigatoria },
      operacionalInicial
    );
    console.warn(
      `\n  AVISO: HOST=${HOST} expoe a interface e a API a rede local (${descricaoAcesso}).\n` +
        `  Restrinja o acesso (firewall/reverse proxy) e limite as origens com NEURO_ALLOWED_ORIGINS.\n`
    );
  }

  // Cifragem em repouso e opcional: sem chave, o metadado declara `cifrado: null`.
  // Uma chave invalida aborta a subida em vez de gravar dados protegidos de
  // forma enganosa (ou sem possibilidade de leitura futura).
  let materialChave: string | undefined = env.NEURO_VIDEO_KEY || undefined;
  if (env.NEURO_VIDEO_KEY_FILE) {
    try {
      materialChave = (await readFile(env.NEURO_VIDEO_KEY_FILE, "utf8")).trim();
    } catch (erro) {
      registrarFalha(
        "error",
        "chave_video_arquivo_falhou",
        { erro: (erro as Error).message },
        operacionalInicial
      );
      console.error("\n  Nao foi possivel ler NEURO_VIDEO_KEY_FILE; abortando a subida.\n");
      process.exit(1);
    }
  }
  let cifradorVideo: CifradorVideo | undefined;
  try {
    cifradorVideo = criarCifradorVideo(interpretarChaveVideo(materialChave));
  } catch (erro) {
    registrarFalha(
      "error",
      "chave_video_invalida",
      { erro: (erro as Error).message },
      operacionalInicial
    );
    console.error(
      `\n  NEURO_VIDEO_KEY invalida: ${(erro as Error).message}. Use 32 bytes em base64 ou 64 caracteres hex.\n`
    );
    process.exit(1);
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

  const armazenadorInicial = new ArmazenadorVideos({
    dir: path.join(path.dirname(LOG_FILE), "videos"),
    maxBytesPorArquivo: VIDEO_UPLOAD_MAX_BYTES,
    retencaoMs: env.VIDEO_RETENCAO_MS,
    maxArquivos: env.VIDEO_MAX_ARQUIVOS,
    maxBytesTotais: env.VIDEO_MAX_BYTES_TOTAIS,
    cifrador: cifradorVideo,
  });
  const auditarInicial = criarAuditar(auditoriaInicial, "sistema");

  // Retencao de videos tambem na subida: arquivos expirados enquanto o servidor
  // esteve desligado nao podem ficar para sempre so porque a rota nao foi chamada.
  void armazenadorInicial
    .aplicarPoliticaRetencao(Date.now())
    .then((resultado) => {
      if (resultado.removidos.length > 0) {
        registrarFalha(
          "info",
          "retencao_videos_startup",
          {
            removidos: resultado.removidos.map((arquivo) => arquivo.segmentoId),
            motivos: resultado.motivos,
            preservados: resultado.preservados,
          },
          operacionalInicial
        );
        auditarInicial({
          acao: "aplicacao_retencao",
          resultado: "sucesso",
          alvo: "videos",
          detalhe: {
            inicializacao: true,
            removidos: resultado.removidos.length,
            preservados: resultado.preservados.length,
            motivos: JSON.stringify(resultado.motivos),
          },
        });
      }
    })
    .catch((err) =>
      registrarFalha("warn", "retencao_videos_falhou", { erro: (err as Error).message }, operacionalInicial)
    );

  // Recuperação acontece antes de abrir as rotas: a API já serve o índice
  // reconciliado. Falha na recuperação não altera dados (append-only) e fica
  // registrada para diagnostico.
  const arquivosExistentes = await armazenadorInicial
    .listar()
    .then((arquivos) => arquivos.map((arquivo) => ({ segmentoId: arquivo.segmentoId })))
    .catch((erro: unknown) => {
      registrarFalha(
        "error",
        "recuperacao_listagem_videos_falhou",
        { erro: (erro as Error).message },
        operacionalInicial
      );
      return [];
    });
  const recuperacao = await aplicarRecuperacaoMonitoramento({
    sessoesFile: MONITORAMENTO_SESSOES_FILE,
    segmentosFile: MONITORAMENTO_SEGMENTOS_FILE,
    arquivosVideo: arquivosExistentes,
    auditar: auditarInicial,
  }).catch((erro: unknown) => {
    registrarFalha(
      "error",
      "recuperacao_monitoramento_falhou",
      { erro: (erro as Error).message },
      operacionalInicial
    );
    return null;
  });
  if (recuperacao && (recuperacao.sessoesAtualizadas > 0 || recuperacao.plano.uploadsPendentes.length > 0)) {
    registrarFalha(
      "warn",
      "recuperacao_monitoramento_resumo",
      {
        sessoes: recuperacao.sessoesAtualizadas,
        segmentosIncompletos: recuperacao.plano.segmentosIncompletos.length,
        uploadsPendentes: recuperacao.plano.uploadsPendentes.length,
      },
      operacionalInicial
    );
  }

  // Registra o backend de visao configurado (URL base resolvida).
  const backendUrl = resolverBackend({}).baseUrl;
  logEvent("info", "backend_configurado", { baseUrl: backendUrl });
  console.log(`  Backend de visao: ${backendUrl}`);
  console.log(
    `  Video em repouso: ${
      cifradorVideo ? "cifrado (aes-256-gcm:v1)" : "em claro (defina NEURO_VIDEO_KEY para cifrar)"
    }`
  );
  console.log(`  Acesso remoto: ${descricaoAcesso}`);
  console.log(
    `  Retencao de videos: ${env.VIDEO_RETENCAO_MS} ms / ${env.VIDEO_MAX_ARQUIVOS} arquivos / ${env.VIDEO_MAX_BYTES_TOTAIS} bytes`
  );
  createServer({
    armazenadorVideos: armazenadorInicial,
    autenticacao,
    auditoriaFile: auditoriaInicial,
    videoRetencaoMs: env.VIDEO_RETENCAO_MS,
    videoMaxArquivos: env.VIDEO_MAX_ARQUIVOS,
    videoMaxBytesTotais: env.VIDEO_MAX_BYTES_TOTAIS,
  }).listen(PORT, HOST, () => {
    logEvent("info", "servidor_iniciado", {
      host: HOST,
      port: PORT,
      logFile: LOG_FILE,
      autenticacao: autenticacao.obrigatoria,
      cifragemVideo: cifradorVideo?.id ?? null,
    });
    console.log(`\n  Neuro Vision rodando em http://${HOST}:${PORT}`);
    console.log(`  Logs em: ${LOG_FILE}\n`);
  });
}
