/**
 * Constantes de caminho/limites, resposta HTTP, registro operacional e leitura de corpo.
 *
 * Extraido de `src/server.ts` na refatoracao de responsabilidades.
 */
import fs from "node:fs";
import { IncomingMessage } from "node:http";
import { ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RegistroOperacional } from "../memoria";
import { gravarOperacional } from "../persistence/repositorio-operacional";
import { env } from "../env";

export const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Localiza a raiz do repositorio pelo `package.json` mais proximo. Necessario
 * porque este modulo roda em duas profundidades: `src/http/` (tsx/vitest) e
 * `dist/` (bundle do esbuild). Um `path.resolve(__dirname, "..")` fixo
 * funcionaria em apenas um dos casos.
 */
export function localizarRaiz(diretorio: string): string {
  let atual = path.resolve(diretorio);
  for (;;) {
    if (fs.existsSync(path.join(atual, "package.json"))) return atual;
    const pai = path.dirname(atual);
    if (pai === atual) return path.resolve(diretorio);
    atual = pai;
  }
}

export const ROOT = localizarRaiz(__dirname);

export const PUBLIC_DIR = path.join(ROOT, "public");

/**
 * Pesos NSFW experimentais (gitignored, nunca commitados): exportados de
 * `modelos/yolonsfw/*.pt` para ONNX por `scripts/exportar-yolo-nsfw.mjs` e
 * servidos sob `/yolonsfw/` quando existem.
 */
export const NSFW_DIR = path.join(ROOT, "modelos", "yolonsfw");

/**
 * Artefatos do **modo offline** (gitignored, nunca commitados): bibliotecas e
 * pesos baixados por `scripts/preparar-offline.mjs` e servidos sob `/vendor/` e
 * `/modelos/`. Sem eles, o cliente cai no CDN (fallback automatico).
 */
export const VENDOR_DIR = path.join(ROOT, "vendor");

export const MODELOS_DIR = path.join(ROOT, "modelos");

export const LOG_DIR = path.join(ROOT, "logs");

export const LOG_FILE = path.join(LOG_DIR, "visao.jsonl");

export const EVENTOS_FILE = path.join(LOG_DIR, "eventos.jsonl");

/** Memoria pesquisavel de gestos/posturas, separada dos fatos visuais (P2.6). */
export const EVENTOS_TEMPORAIS_FILE = path.join(LOG_DIR, "eventos-temporais.jsonl");

export const OPERACIONAL_FILE = path.join(LOG_DIR, "operacional.jsonl");

export const CICLOS_FILE = path.join(LOG_DIR, "ciclos.jsonl");

/** Indice duravel de sessoes e segmentos do modo Camera de Seguranca (Fase 3). */
export const MONITORAMENTO_SESSOES_FILE = path.join(LOG_DIR, "monitoramento-sessoes.jsonl");

export const MONITORAMENTO_SEGMENTOS_FILE = path.join(LOG_DIR, "monitoramento-segmentos.jsonl");

/** Bytes dos segmentos. Fora do git (`logs/*`); videos com pessoas sao sensiveis. */
export const VIDEOS_DIR = path.join(LOG_DIR, "videos");

/** Referencia do ambiente e linha do tempo de mudancas (Fase 3). */
export const CENA_REFERENCIAS_FILE = path.join(LOG_DIR, "cena-referencias.jsonl");

export const CENA_MUDANCAS_FILE = path.join(LOG_DIR, "cena-mudancas.jsonl");

export const LOG_MAX_BYTES = env.LOG_MAX_BYTES || 5_000_000;

export const SNAP_DIR = path.join(LOG_DIR, "snapshots");

export const SNAP_CACHE_TTL_MS = 5 * 60 * 1000;

// 5 minutos

export interface SnapshotCacheEntry {
  url: string;
  hash: string;
  ts: number;
}

export const SNAP_URL = "/snapshots";

export interface PoliticaSnapshots {
  /** Tamanho total maximo de `logs/snapshots/` em bytes (0 desativa). */
  maxBytes: number;
  /** Quantidade maxima de arquivos (0 desativa). */
  maxFiles: number;
  /** Idade maxima em ms (0 desativa). */
  maxAgeMs: number;
}

/**
 * Limites de retencao dos snapshots. Configuraveis por variaveis de ambiente:
 * `SNAP_MAX_BYTES`, `SNAP_MAX_FILES` e `SNAP_MAX_AGE_DAYS` (0 desativa o limite
 * correspondente). Os valores precisam ser finitos e nao negativos.
 */
export const POLITICA_SNAPSHOTS_PADRAO: PoliticaSnapshots = {
  maxBytes: env.SNAP_MAX_BYTES,
  maxFiles: env.SNAP_MAX_FILES,
  maxAgeMs: env.SNAP_MAX_AGE_DAYS * 24 * 60 * 60 * 1000,
};

/** Intervalo minimo entre limpezas automaticas disparadas por novas gravacoes. */
export const SNAP_CLEAN_INTERVAL_MS = env.SNAP_CLEAN_INTERVAL_MS;

/** Limite do corpo JSON de `POST /api/log`. */
export const BODY_MAX_BYTES = env.BODY_MAX_BYTES;

/** Limite do corpo JSON de `POST /api/visao` (imagem base64 + snapshot). */
export const VISAO_BODY_MAX_BYTES = env.VISAO_BODY_MAX_BYTES;

/** Limite do corpo binario de `POST /api/monitoramento/videos/:id`. */
export const VIDEO_UPLOAD_MAX_BYTES = env.VIDEO_MAX_BYTES;

/** Limite de um unico snapshot (data URL/base64) aceito para gravacao. */
export function limiteUploadSnapshot(): number {
  return env.SNAP_UPLOAD_MAX_BYTES;
}

export const EXTENSOES_SNAPSHOT = /\.(jpe?g|png|webp)$/i;

/** Extrai, de forma segura, o nome do arquivo a partir de uma URL `/snapshots/...`. */
export function nomeArquivoSnapshot(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const idx = url.lastIndexOf("/");
  const nome = idx >= 0 ? url.slice(idx + 1) : url;
  if (!EXTENSOES_SNAPSHOT.test(nome)) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(nome)) return null;
  return nome;
}

/** Arquivos de log preservaveis: o atual e a ultima rotacao. */
export function arquivosDeLog(logFile: string): string[] {
  return [logFile, `${logFile}.1`];
}

/**
 * Arquivos cujos `snapshot` precisam ser preservados: o historico de
 * observacoes e o de eventos estruturados (ambos podem referenciar snapshots).
 */
export function arquivosDeMemoria(logFile: string, eventosFile: string): string[] {
  return [...arquivosDeLog(logFile), ...arquivosDeLog(eventosFile)];
}

export const LOOPBACK = /^(127(\.\d{1,3}){3}|::1|localhost)$/i;

/**
 * Um host que nao seja loopback expoe a interface e a API (sem autenticacao) a
 * rede local. O servidor so aceita esse bind com `NEURO_ALLOW_REMOTE=1`.
 */
export function hostExpostoNaRede(host: string): boolean {
  const limpo = host.trim().replace(/^\[|\]$/g, "");
  if (!limpo) return true;
  return !LOOPBACK.test(limpo);
}

/** Origens extras permitidas alem da propria (CSV em `NEURO_ALLOWED_ORIGINS`). */
export function origensPermitidas(valor: string | undefined): string[] {
  return (valor ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
}

/**
 * Bloqueia requisicoes de origem cruzada. Sem cabecalho `Origin` (mesma origem
 * ou cliente nao-navegador) a requisicao passa; com `Origin`, ele precisa bater
 * com o host da requisicao ou estar em `NEURO_ALLOWED_ORIGINS`.
 */
export function origemBloqueada(
  origem: string | undefined,
  host: string | undefined,
  permitidas: string[]
): boolean {
  if (!origem) return false;
  let origemHost: string;
  try {
    origemHost = new URL(origem).host;
  } catch {
    return true;
  }
  if (host && origemHost === host) return false;
  return !permitidas.includes(origem);
}

export const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".wasm": "application/wasm",
  ".ico": "image/x-icon",
  ".onnx": "application/octet-stream",
  ".task": "application/octet-stream",
};

export function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

export type NivelLog = "info" | "warn" | "error";

export let operacionalFileAtivo: string | undefined;

export function logEvent(
  nivel: NivelLog,
  evento: string,
  dados: Record<string, unknown> = {}
): void {
  const linha = JSON.stringify({ ts: new Date().toISOString(), nivel, evento, ...dados });
  if (nivel === "error") console.error(linha);
  else console.log(linha);
}

/**
 * Falha operacional: console + `operacional.jsonl`. O arquivo e opcional para
 * nao alterar callers antigos; `createServer` sempre fornece o caminho padrao.
 * Best-effort: falha ao registrar nao pode derrubar a requisicao em andamento.
 */
export function registrarFalha(
  nivel: NivelLog,
  evento: string,
  dados: Record<string, unknown> = {},
  operacionalFile = operacionalFileAtivo
): void {
  logEvent(nivel, evento, dados);
  if (!operacionalFile) return;
  const registro: RegistroOperacional = {
    timestamp: new Date().toISOString(),
    nivel: nivel === "warn" ? "aviso" : nivel === "error" ? "erro" : "info",
    origem: "servidor",
    mensagem: evento,
    detalhe: Object.keys(dados).length > 0 ? JSON.stringify(dados) : undefined,
  };
  void gravarOperacional(registro, operacionalFile, LOG_MAX_BYTES).catch((err: unknown) => {
    logEvent("error", "operacional_falhou", { erro: (err as Error).message });
  });
}

export function readBody(req: IncomingMessage, limit = 1_000_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Payload muito grande"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Le um corpo binario (upload de video) sem converter para texto. */
export function readBodyBuffer(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Payload muito grande"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Atualiza o destino padrao usado por `registrarFalha` sem argumento explicito. */
export function definirArquivoOperacionalAtivo(caminho: string | undefined): void {
  operacionalFileAtivo = caminho;
}
