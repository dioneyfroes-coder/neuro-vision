import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gerarDescricao } from "./ollama";
import type { Caixa, EntradaLog, ObjetoVisto, TipoEntrada } from "./types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
export const LOG_DIR = path.join(ROOT, "logs");
export const LOG_FILE = path.join(LOG_DIR, "visao.jsonl");
export const LOG_MAX_BYTES = Number(process.env.LOG_MAX_BYTES) || 5_000_000;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".wasm": "application/wasm",
  ".ico": "image/x-icon",
};

export function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage, limit = 1_000_000): Promise<string> {
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

function normalizarCaixa(valor: unknown): Caixa {
  const v = (typeof valor === "object" && valor !== null ? valor : {}) as Record<string, unknown>;
  const num = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  return {
    xmin: num(v.xmin),
    ymin: num(v.ymin),
    xmax: num(v.xmax),
    ymax: num(v.ymax),
  };
}

function normalizarObjetos(valor: unknown): ObjetoVisto[] {
  if (!Array.isArray(valor)) return [];
  const objetos: ObjetoVisto[] = [];
  for (const item of valor) {
    if (typeof item !== "object" || item === null || !("nome" in item)) continue;
    const o = item as Record<string, unknown>;
    if (typeof o.nome !== "string") continue;
    objetos.push({
      nome: o.nome,
      rotulo: typeof o.rotulo === "string" ? o.rotulo : o.nome,
      score: typeof o.score === "number" && Number.isFinite(o.score) ? o.score : 0,
      caixa: normalizarCaixa(o.caixa),
    });
  }
  return objetos;
}

export function montarEntrada(payload: unknown): EntradaLog {
  const p = (typeof payload === "object" && payload !== null ? payload : {}) as Record<
    string,
    unknown
  >;
  const tipo: TipoEntrada = p.tipo === "descricao" ? "descricao" : "deteccao";
  return {
    timestamp: typeof p.timestamp === "string" ? p.timestamp : new Date().toISOString(),
    modelo: typeof p.modelo === "string" ? p.modelo : "desconhecido",
    objetos: normalizarObjetos(p.objetos),
    resumo: typeof p.resumo === "string" ? p.resumo : "",
    tipo,
  };
}

async function rotacionarSeNecessario(filePath: string): Promise<void> {
  try {
    const info = await fs.promises.stat(filePath);
    if (info.size < LOG_MAX_BYTES) return;
  } catch {
    return;
  }
  await fs.promises.rename(filePath, `${filePath}.1`).catch(() => {});
}

export async function appendLogEntry(entry: EntradaLog, filePath: string = LOG_FILE): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await rotacionarSeNecessario(filePath);
  await fs.promises.appendFile(filePath, JSON.stringify(entry) + "\n", "utf8");
}

async function lerUltimasLinhas(filePath: string, alvo: number): Promise<string[]> {
  const handle = await fs.promises.open(filePath, "r");
  try {
    let tamanho = (await handle.stat()).size;
    const chunkSize = 64 * 1024;
    let buffer = Buffer.alloc(0);
    let linhas: string[] = [];
    while (tamanho > 0 && linhas.length <= alvo) {
      const leitura = Math.min(chunkSize, tamanho);
      tamanho -= leitura;
      const chunk = Buffer.alloc(leitura);
      await handle.read(chunk, 0, leitura, tamanho);
      buffer = Buffer.concat([chunk, buffer]);
      linhas = buffer.toString("utf8").split("\n");
    }
    return linhas;
  } finally {
    await handle.close();
  }
}

export async function lerLogEntries(
  filePath: string = LOG_FILE,
  limit = 100
): Promise<EntradaLog[]> {
  const n = Math.max(0, Math.trunc(limit));
  if (n === 0) return [];
  let linhas: string[];
  try {
    linhas = await lerUltimasLinhas(filePath, n);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const entradas: EntradaLog[] = [];
  for (const linha of linhas) {
    const texto = linha.trim();
    if (!texto) continue;
    try {
      entradas.push(JSON.parse(texto) as EntradaLog);
    } catch {
      // ignora linhas corrompidas
    }
  }
  return entradas.slice(-n).reverse();
}

export async function limparLog(filePath: string = LOG_FILE): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, "", "utf8");
}

export function resolveStaticFile(rawUrl: string, publicDir: string = PUBLIC_DIR): string | null {
  const pathname = decodeURIComponent(new URL(rawUrl, "http://localhost").pathname);
  const relPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(publicDir, relPath));
  if (!filePath.startsWith(publicDir)) return null;
  return filePath;
}

function serveStatic(req: IncomingMessage, res: ServerResponse, publicDir: string): void {
  const filePath = resolveStaticFile(req.url ?? "/", publicDir);
  if (!filePath) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Acesso negado");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Nao encontrado");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

async function handleLog(req: IncomingMessage, res: ServerResponse, logFile: string): Promise<void> {
  try {
    const raw = await readBody(req);
    const payload: unknown = JSON.parse(raw || "{}");
    const entry = montarEntrada(payload);
    await appendLogEntry(entry, logFile);
    sendJson(res, 200, { ok: true, entrada: entry });
  } catch (err) {
    sendJson(res, 400, { ok: false, erro: (err as Error).message });
  }
}

async function handleVisao(
  req: IncomingMessage,
  res: ServerResponse,
  config: ServerConfig
): Promise<void> {
  const logFile = config.logFile ?? LOG_FILE;
  try {
    const raw = await readBody(req, 12_000_000);
    const payload = (JSON.parse(raw || "{}")) as {
      imagem?: unknown;
      modelo?: unknown;
      anterior?: unknown;
    };
    const imagem = typeof payload.imagem === "string" ? payload.imagem : "";
    if (!imagem) {
      sendJson(res, 400, { ok: false, erro: "campo 'imagem' obrigatorio (base64)" });
      return;
    }
    const descricao = await gerarDescricao(imagem, {
      modelo: typeof payload.modelo === "string" ? payload.modelo : undefined,
      host: config.ollamaUrl,
      anterior: typeof payload.anterior === "string" ? payload.anterior : undefined,
    });

    const entry: EntradaLog = {
      timestamp: new Date().toISOString(),
      modelo: descricao.modelo,
      objetos: [],
      resumo: descricao.texto,
      tipo: "descricao",
    };
    await appendLogEntry(entry, logFile);

    sendJson(res, 200, {
      ok: true,
      descricao: descricao.texto,
      modelo: descricao.modelo,
      tokens: descricao.tokens,
      ms: descricao.duracaoMs,
    });
  } catch (err) {
    const mensagem = (err as Error).message;
    const status = mensagem.startsWith("Ollama") || err instanceof TypeError ? 502 : 500;
    sendJson(res, status, { ok: false, erro: "Ollama: " + mensagem });
  }
}

async function handleListLogs(
  req: IncomingMessage,
  res: ServerResponse,
  logFile: string
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/api/logs", "http://localhost");
    const limitParam = Number(url.searchParams.get("limit"));
    const limite = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 500) : 100;
    const entradas = await lerLogEntries(logFile, limite);
    sendJson(res, 200, { ok: true, total: entradas.length, entradas });
  } catch (err) {
    sendJson(res, 500, { ok: false, erro: (err as Error).message });
  }
}

async function handleClearLogs(res: ServerResponse, logFile: string): Promise<void> {
  try {
    await limparLog(logFile);
    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendJson(res, 500, { ok: false, erro: (err as Error).message });
  }
}

export interface ServerConfig {
  logFile?: string;
  publicDir?: string;
  ollamaUrl?: string;
}

export function createServer(config: ServerConfig = {}): http.Server {
  const logFile = config.logFile ?? LOG_FILE;
  const publicDir = config.publicDir ?? PUBLIC_DIR;

  return http.createServer((req, res) => {
    const url = req.url ?? "/";
    const pathname = url.split("?")[0];
    if (req.method === "POST" && url === "/api/log") {
      void handleLog(req, res, logFile);
      return;
    }
    if (req.method === "POST" && url === "/api/visao") {
      void handleVisao(req, res, config);
      return;
    }
    if (req.method === "GET" && pathname === "/api/logs") {
      void handleListLogs(req, res, logFile);
      return;
    }
    if (req.method === "DELETE" && pathname === "/api/logs") {
      void handleClearLogs(res, logFile);
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

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryUrl) {
  const PORT = Number(process.env.PORT) || 3000;
  const HOST = process.env.HOST || "127.0.0.1";
  createServer().listen(PORT, HOST, () => {
    console.log(`\n  Neuro Vision rodando em http://${HOST}:${PORT}`);
    console.log(`  Logs em: ${LOG_FILE}\n`);
  });
}
