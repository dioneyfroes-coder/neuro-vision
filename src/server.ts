import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ErroOllama,
  forcarCarregamento,
  gerarDescricaoStream,
  modeloEmMemoria,
  modelosEmMemoria,
  MODELO_PADRAO,
  type ModoAnalise,
} from "./ollama";
import { colapsarRepeticoes, cortarFraseIncompleta, ehSemMudanca } from "./texto";
import type { Caixa, EntradaLog, ObjetoVisto, TipoEntrada } from "./types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
export const LOG_DIR = path.join(ROOT, "logs");
export const LOG_FILE = path.join(LOG_DIR, "visao.jsonl");
export const LOG_MAX_BYTES = Number(process.env.LOG_MAX_BYTES) || 5_000_000;
export const SNAP_DIR = path.join(LOG_DIR, "snapshots");
export const SNAP_URL = "/snapshots";

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

export type NivelLog = "info" | "warn" | "error";

export function logEvent(
  nivel: NivelLog,
  evento: string,
  dados: Record<string, unknown> = {}
): void {
  const linha = JSON.stringify({ ts: new Date().toISOString(), nivel, evento, ...dados });
  if (nivel === "error") console.error(linha);
  else console.log(linha);
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

function extrairBase64Imagem(imagem: unknown): string | null {
  if (typeof imagem !== "string" || !imagem) return null;
  const index = imagem.indexOf("base64,");
  const b64 = index >= 0 ? imagem.slice(index + 7) : imagem;
  return b64.trim() ? b64 : null;
}

export async function salvarSnapshot(
  imagem: unknown,
  snapDir: string = SNAP_DIR
): Promise<string | null> {
  const b64 = extrairBase64Imagem(imagem);
  if (!b64) return null;
  await fs.promises.mkdir(snapDir, { recursive: true });
  const nome = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  await fs.promises.writeFile(path.join(snapDir, nome), Buffer.from(b64, "base64"));
  return `${SNAP_URL}/${nome}`;
}

export function pathnameDecodificado(rawUrl: string | undefined): string | null {
  try {
    return decodeURIComponent(new URL(rawUrl ?? "/", "http://localhost").pathname);
  } catch {
    return null;
  }
}

export function resolverCaminhoDentroDaBase(baseDir: string, relPath: string): string | null {
  if (relPath.includes("\0")) return null;
  const base = path.resolve(baseDir);
  const destino = path.resolve(base, relPath);
  const relativo = path.relative(base, destino);
  if (
    relativo === "" ||
    relativo === ".." ||
    relativo.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativo)
  ) {
    return null;
  }
  return destino;
}

export function resolveStaticFile(rawUrl: string, publicDir: string = PUBLIC_DIR): string | null {
  const pathname = pathnameDecodificado(rawUrl);
  if (pathname === null) return null;
  const relPath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  if (!relPath) return null;
  return resolverCaminhoDentroDaBase(publicDir, relPath);
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

async function handleLog(
  req: IncomingMessage,
  res: ServerResponse,
  logFile: string,
  snapDir: string
): Promise<void> {
  try {
    const raw = await readBody(req);
    const payload: unknown = JSON.parse(raw || "{}");
    const entry = montarEntrada(payload);
    const p = (typeof payload === "object" && payload !== null ? payload : {}) as Record<
      string,
      unknown
    >;
    const snapshot = await salvarSnapshot(p.snapshot, snapDir);
    if (snapshot) entry.snapshot = snapshot;
    await appendLogEntry(entry, logFile);
    sendJson(res, 200, { ok: true, entrada: entry });
  } catch (err) {
    sendJson(res, 400, { ok: false, erro: (err as Error).message });
  }
}

async function streamVisao(
  res: ServerResponse,
  imagem: string,
  opcoes: {
    modelo?: string;
    host?: string;
    anterior?: string;
    modo?: ModoAnalise;
    roteiro?: string;
    base?: boolean;
  },
  logFile: string,
  snapDir: string,
  snapshot: unknown
): Promise<void> {
  const iterador = gerarDescricaoStream(imagem, opcoes);
  const primeiro = await iterador.next();
  if (primeiro.done) {
    throw new Error(
      "Ollama retornou um stream vazio (nenhum texto). Verifique se o modelo suporta 'think:false' ou aumente num_predict."
    );
  }

  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
  });

  let texto = primeiro.value;
  res.write(JSON.stringify({ type: "chunk", response: primeiro.value }) + "\n");

  let resultado = await iterador.next();
  while (!resultado.done) {
    texto += resultado.value;
    res.write(JSON.stringify({ type: "chunk", response: resultado.value }) + "\n");
    resultado = await iterador.next();
  }

  const resumo = resultado.value;
  const limpo = colapsarRepeticoes(cortarFraseIncompleta(texto));
  const tipo: TipoEntrada = opcoes.modo === "roteiro" ? "roteiro" : "descricao";
  const papel = opcoes.modo === "roteiro" ? (opcoes.base === true ? "base" : "delta") : undefined;
  const semMudanca = papel === "delta" && ehSemMudanca(limpo);

  if (!semMudanca) {
    const entry: EntradaLog = {
      timestamp: new Date().toISOString(),
      modelo: resumo.modelo,
      objetos: [],
      resumo: limpo,
      tipo,
      papel,
      ms: resumo.duracaoMs,
      tokens: resumo.tokens,
    };
    const snap = await salvarSnapshot(snapshot, snapDir);
    if (snap) entry.snapshot = snap;
    await appendLogEntry(entry, logFile);

    res.write(
      JSON.stringify({
        type: "done",
        descricao: limpo,
        modelo: resumo.modelo,
        tokens: resumo.tokens,
        ms: resumo.duracaoMs,
        snapshot: entry.snapshot,
        tipo,
        papel,
        semMudanca: false,
      }) + "\n"
    );
  } else {
    res.write(
      JSON.stringify({
        type: "done",
        descricao: limpo,
        modelo: resumo.modelo,
        tokens: resumo.tokens,
        ms: resumo.duracaoMs,
        tipo,
        papel,
        semMudanca: true,
      }) + "\n"
    );
  }
  res.end();
}

async function handleVisao(
  req: IncomingMessage,
  res: ServerResponse,
  config: ServerConfig
): Promise<void> {
  let payload: unknown;
  try {
    const raw = await readBody(req, 12_000_000);
    payload = JSON.parse(raw || "{}");
  } catch (err) {
    sendJson(res, 400, { ok: false, erro: (err as Error).message });
    return;
  }

  const p = (typeof payload === "object" && payload !== null ? payload : {}) as Record<
    string,
    unknown
  >;
  const imagem = typeof p.imagem === "string" ? p.imagem : "";
  if (!imagem) {
    sendJson(res, 400, { ok: false, erro: "campo 'imagem' obrigatorio (base64)" });
    return;
  }

  try {
    await streamVisao(
      res,
      imagem,
      {
        modelo: typeof p.modelo === "string" ? p.modelo : undefined,
        host: config.ollamaUrl,
        anterior: typeof p.anterior === "string" ? p.anterior : undefined,
        modo: p.modo === "roteiro" ? "roteiro" : "descricao",
        roteiro: typeof p.roteiro === "string" ? p.roteiro : undefined,
        base: p.base === true,
      },
      config.logFile ?? LOG_FILE,
      config.snapDir ?? SNAP_DIR,
      p.snapshot
    );
  } catch (err) {
    const mensagem = (err as Error).message;
    const status = err instanceof TypeError || err instanceof ErroOllama ? 502 : 500;
    logEvent("error", "visao_falhou", { status, erro: mensagem });
    if (!res.headersSent) {
      sendJson(res, status, { ok: false, erro: "Ollama: " + mensagem });
    } else {
      res.write(JSON.stringify({ type: "erro", erro: "Ollama: " + mensagem }) + "\n");
      res.end();
    }
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
    logEvent("error", "listar_logs_falhou", { erro: (err as Error).message });
    sendJson(res, 500, { ok: false, erro: (err as Error).message });
  }
}

async function handleClearLogs(res: ServerResponse, logFile: string): Promise<void> {
  try {
    await limparLog(logFile);
    sendJson(res, 200, { ok: true });
  } catch (err) {
    logEvent("error", "limpar_logs_falhou", { erro: (err as Error).message });
    sendJson(res, 500, { ok: false, erro: (err as Error).message });
  }
}

interface InfoOllama {
  online: boolean;
  modelos: string[];
  carregados: string[];
  erro: string;
}

async function consultarOllama(host?: string): Promise<InfoOllama> {
  const base = (host ?? process.env.OLLAMA_HOST ?? "http://localhost:11434").replace(/\/+$/, "");
  try {
    const resposta = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!resposta.ok) return { online: false, modelos: [], carregados: [], erro: `HTTP ${resposta.status}` };
    const dados = (await resposta.json()) as { models?: { name?: string }[] };
    const modelos = (dados.models ?? [])
      .map((m) => m.name ?? "")
      .filter((n) => n.length > 0);
    const carregados = await modelosEmMemoria({ host: base, timeoutMs: 3000 });
    return { online: true, modelos, carregados, erro: "" };
  } catch (err) {
    return { online: false, modelos: [], carregados: [], erro: (err as Error).message };
  }
}

async function handlePreparar(res: ServerResponse, config: ServerConfig): Promise<void> {
  const modelo = process.env.OLLAMA_MODEL ?? MODELO_PADRAO;
  try {
    const carregandoMs = await forcarCarregamento({ modelo, host: config.ollamaUrl });
    const emMemoria = await modeloEmMemoria({ modelo, host: config.ollamaUrl });
    sendJson(res, 200, { ok: true, modelo, carregado: emMemoria, carregandoMs });
    logEvent("info", "modelo_preparado", { modelo, carregandoMs, carregado: emMemoria });
  } catch (err) {
    logEvent("error", "modelo_preparacao_falhou", { modelo, erro: (err as Error).message });
    sendJson(res, 502, { ok: false, erro: "Ollama: " + (err as Error).message });
  }
}

async function handleHealth(res: ServerResponse, config: ServerConfig): Promise<void> {
  const ollama = await consultarOllama(config.ollamaUrl);
  sendJson(res, 200, { ok: true, ollama });
}

function serveSnapshot(
  req: IncomingMessage,
  res: ServerResponse,
  snapDir: string
): void {
  const pathname = pathnameDecodificado(req.url);
  if (pathname === null) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Requisicao invalida");
    return;
  }
  const rel = pathname.replace(/^\/snapshots\/?/, "");
  const filePath = resolverCaminhoDentroDaBase(snapDir, rel);
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
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
    });
    res.end(data);
  });
}

export interface ServerConfig {
  logFile?: string;
  snapDir?: string;
  publicDir?: string;
  ollamaUrl?: string;
}

export function createServer(config: ServerConfig = {}): http.Server {
  const logFile = config.logFile ?? LOG_FILE;
  const snapDir = config.snapDir ?? SNAP_DIR;
  const publicDir = config.publicDir ?? PUBLIC_DIR;

  return http.createServer((req, res) => {
    const url = req.url ?? "/";
    const pathname = url.split("?")[0];
    if (req.method === "POST" && url === "/api/log") {
      void handleLog(req, res, logFile, snapDir);
      return;
    }
    if (req.method === "POST" && url === "/api/visao") {
      void handleVisao(req, res, config);
      return;
    }
    if (req.method === "GET" && pathname === "/api/visao/preparar") {
      void handlePreparar(res, config);
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
    if (req.method === "GET" && pathname === "/api/health") {
      void handleHealth(res, config);
      return;
    }
    if (req.method === "GET" && pathname.startsWith("/snapshots/")) {
      serveSnapshot(req, res, snapDir);
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
    logEvent("info", "servidor_iniciado", { host: HOST, port: PORT, logFile: LOG_FILE });
    console.log(`\n  Neuro Vision rodando em http://${HOST}:${PORT}`);
    console.log(`  Logs em: ${LOG_FILE}\n`);
  });
}
