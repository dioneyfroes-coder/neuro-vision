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
import { ehCancelamento } from "./erros";
import {
  appendJsonl,
  filtrarEventos,
  lerUltimosJsonl,
  limparJsonl,
  montarEvento,
  montarOperacional,
  normalizarTipoEvento,
  reidratarContexto,
} from "./memoria";
import type { RegistroOperacional } from "./memoria";
import type {
  Caixa,
  EntradaLog,
  EventoVisual,
  MotivoAnalise,
  ObjetoVisto,
  TipoEntrada,
  TipoEventoVisual,
} from "./types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
export const LOG_DIR = path.join(ROOT, "logs");
export const LOG_FILE = path.join(LOG_DIR, "visao.jsonl");
export const EVENTOS_FILE = path.join(LOG_DIR, "eventos.jsonl");
export const OPERACIONAL_FILE = path.join(LOG_DIR, "operacional.jsonl");
export const LOG_MAX_BYTES = Number(process.env.LOG_MAX_BYTES) || 5_000_000;
export const SNAP_DIR = path.join(LOG_DIR, "snapshots");
export const SNAP_URL = "/snapshots";

function numeroEnv(nome: string, padrao: number): number {
  const valor = Number(process.env[nome]);
  return Number.isFinite(valor) && valor >= 0 ? valor : padrao;
}

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
  maxBytes: numeroEnv("SNAP_MAX_BYTES", 200_000_000),
  maxFiles: numeroEnv("SNAP_MAX_FILES", 1000),
  maxAgeMs: numeroEnv("SNAP_MAX_AGE_DAYS", 30) * 24 * 60 * 60 * 1000,
};

/** Intervalo minimo entre limpezas automaticas disparadas por novas gravacoes. */
export const SNAP_CLEAN_INTERVAL_MS = numeroEnv("SNAP_CLEAN_INTERVAL_MS", 10 * 60 * 1000);

/** Limite do corpo JSON de `POST /api/log`. */
export const BODY_MAX_BYTES = numeroEnv("BODY_MAX_BYTES", 1_000_000);
/** Limite do corpo JSON de `POST /api/visao` (imagem base64 + snapshot). */
export const VISAO_BODY_MAX_BYTES = numeroEnv("VISAO_BODY_MAX_BYTES", 12_000_000);
/** Limite de um unico snapshot (data URL/base64) aceito para gravacao. */
export function limiteUploadSnapshot(): number {
  return numeroEnv("SNAP_UPLOAD_MAX_BYTES", 5_000_000);
}

const EXTENSOES_SNAPSHOT = /\.(jpe?g|png|webp)$/i;

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

const LOOPBACK = /^(127(\.\d{1,3}){3}|::1|localhost)$/i;

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

const MOTIVOS_VALIDOS: MotivoAnalise[] = [
  "primeira_analise",
  "mudanca_de_cena",
  "nova_entidade",
  "desaparecimento",
  "movimento",
  "baixa_confianca",
  "resumo_periodico",
  "manual",
  "falha_percepcao",
];

/** Normaliza um valor de `motivo` para o tipo ou `undefined` quando invalido. */
export function normalizarMotivo(valor: unknown): MotivoAnalise | undefined {
  return typeof valor === "string" && MOTIVOS_VALIDOS.includes(valor as MotivoAnalise)
    ? (valor as MotivoAnalise)
    : undefined;
}

const TIPOS_ENTRADA: TipoEntrada[] = ["deteccao", "descricao", "roteiro"];

/** Normaliza o tipo de entrada aceito em `POST /api/log` (inclui `roteiro`). */
export function normalizarTipoEntrada(valor: unknown): TipoEntrada {
  return typeof valor === "string" && TIPOS_ENTRADA.includes(valor as TipoEntrada)
    ? (valor as TipoEntrada)
    : "deteccao";
}

/** Preserva apenas numeros finitos; descarta strings, NaN e Infinity. */
function campoNumero(valor: unknown): number | undefined {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : undefined;
}

/** O papel (`base`/`delta`) so faz sentido em entradas do tipo `roteiro`. */
function normalizarPapel(valor: unknown, tipo: TipoEntrada): "base" | "delta" | undefined {
  if (tipo !== "roteiro") return undefined;
  return valor === "base" || valor === "delta" ? valor : undefined;
}

export function montarEntrada(payload: unknown): EntradaLog {
  const p = (typeof payload === "object" && payload !== null ? payload : {}) as Record<
    string,
    unknown
  >;
  const tipo = normalizarTipoEntrada(p.tipo);
  return {
    timestamp: typeof p.timestamp === "string" ? p.timestamp : new Date().toISOString(),
    modelo: typeof p.modelo === "string" ? p.modelo : "desconhecido",
    objetos: normalizarObjetos(p.objetos),
    resumo: typeof p.resumo === "string" ? p.resumo : "",
    tipo,
    papel: normalizarPapel(p.papel, tipo),
    ms: campoNumero(p.ms),
    tokens: campoNumero(p.tokens),
    motivo: normalizarMotivo(p.motivo),
  };
}

export async function appendLogEntry(entry: EntradaLog, filePath: string = LOG_FILE): Promise<void> {
  await appendJsonl(entry, filePath, LOG_MAX_BYTES);
}

export async function lerLogEntries(
  filePath: string = LOG_FILE,
  limit = 100
): Promise<EntradaLog[]> {
  return lerUltimosJsonl<EntradaLog>(filePath, limit);
}

export async function limparLog(filePath: string = LOG_FILE): Promise<void> {
  await limparJsonl(filePath);
}

export async function appendEvento(
  evento: EventoVisual,
  filePath: string = EVENTOS_FILE
): Promise<void> {
  await appendJsonl(evento, filePath, LOG_MAX_BYTES);
}

export async function lerEventos(
  filePath: string = EVENTOS_FILE,
  limit = 100
): Promise<EventoVisual[]> {
  return lerUltimosJsonl<EventoVisual>(filePath, limit);
}

export async function limparEventos(filePath: string = EVENTOS_FILE): Promise<void> {
  await limparJsonl(filePath);
}

export async function appendOperacional(
  registro: RegistroOperacional,
  filePath: string = OPERACIONAL_FILE
): Promise<void> {
  await appendJsonl(registro, filePath, LOG_MAX_BYTES);
}

export async function lerOperacional(
  filePath: string = OPERACIONAL_FILE,
  limit = 100
): Promise<RegistroOperacional[]> {
  return lerUltimosJsonl<RegistroOperacional>(filePath, limit);
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

function campoTipoTexto(valor: unknown, campo: string): string | null {
  if (valor === undefined || valor === null || typeof valor === "string") return null;
  return `campo '${campo}' deve ser texto`;
}

/** Valida o tamanho de um snapshot (data URL/base64) antes de gravar. */
export function validarSnapshot(
  imagem: unknown,
  maxBytes = limiteUploadSnapshot()
): string | null {
  if (imagem === undefined || imagem === null) return null;
  if (typeof imagem !== "string") return "campo 'snapshot' deve ser texto (data URL)";
  const b64 = extrairBase64Imagem(imagem);
  if (!b64) return null;
  const bytes = Math.floor((b64.length * 3) / 4);
  if (bytes > maxBytes) return `snapshot excede o limite de ${maxBytes} bytes`;
  return null;
}

/** Valida tipos do payload de `POST /api/log`. Retorna a mensagem de erro ou null. */
export function validarPayloadLog(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return "payload deve ser um objeto JSON";
  }
  const p = payload as Record<string, unknown>;
  if (p.objetos !== undefined && !Array.isArray(p.objetos)) {
    return "campo 'objetos' deve ser uma lista";
  }
  const texto = campoTipoTexto(p.resumo, "resumo") ?? campoTipoTexto(p.modelo, "modelo");
  if (texto) return texto;
  return validarSnapshot(p.snapshot);
}

/** Valida tipos do payload de `POST /api/visao`. Retorna a mensagem de erro ou null. */
export function validarPayloadVisao(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return "payload deve ser um objeto JSON";
  }
  const p = payload as Record<string, unknown>;
  const texto =
    campoTipoTexto(p.imagem, "imagem") ??
    campoTipoTexto(p.modelo, "modelo") ??
    campoTipoTexto(p.anterior, "anterior") ??
    campoTipoTexto(p.roteiro, "roteiro");
  if (texto) return texto;
  if (p.motivo !== undefined && p.motivo !== null && !normalizarMotivo(p.motivo)) {
    return "campo 'motivo' tem valor invalido";
  }
  return validarSnapshot(p.snapshot);
}

interface ArquivoSnapshot {
  nome: string;
  caminho: string;
  tamanho: number;
  mtimeMs: number;
  referenciado: boolean;
}

export interface ResultadoLimpezaSnapshots {
  removidos: number;
  mantidos: number;
  bytesLiberados: number;
  erros: string[];
}

export interface OpcoesLimpezaSnapshots {
  snapDir?: string;
  logFiles?: string[];
  politica?: PoliticaSnapshots;
  agora?: number;
}

/** Coleta os nomes de snapshot referenciados pela parte preservada do historico. */
async function coletarSnapshotsReferenciados(logFiles: string[]): Promise<Set<string>> {
  const referenciados = new Set<string>();
  for (const arquivo of logFiles) {
    let conteudo: string;
    try {
      conteudo = await fs.promises.readFile(arquivo, "utf8");
    } catch {
      continue;
    }
    for (const linha of conteudo.split("\n")) {
      const texto = linha.trim();
      if (!texto) continue;
      try {
        const entrada = JSON.parse(texto) as { snapshot?: unknown };
        const nome = nomeArquivoSnapshot(entrada.snapshot);
        if (nome) referenciados.add(nome);
      } catch {
        // ignora linhas corrompidas
      }
    }
  }
  return referenciados;
}

async function listarSnapshots(snapDir: string): Promise<ArquivoSnapshot[]> {
  const nomes = await fs.promises.readdir(snapDir);
  const arquivos: ArquivoSnapshot[] = [];
  for (const nome of nomes) {
    if (!nomeArquivoSnapshot(nome)) continue;
    const caminho = path.join(snapDir, nome);
    try {
      const info = await fs.promises.stat(caminho);
      if (!info.isFile()) continue;
      arquivos.push({
        nome,
        caminho,
        tamanho: info.size,
        mtimeMs: info.mtimeMs,
        referenciado: false,
      });
    } catch {
      // ignora arquivos que sumiram ou estao inacessiveis
    }
  }
  return arquivos;
}

/**
 * Aplica a politica de retencao a `logs/snapshots/` sem interromper requisicoes
 * (toda a funcao e assincrona e tolera falhas parciais do sistema de arquivos).
 *
 * Regras:
 * - snapshots referenciados pelo historico preservado sao mantidos enquanto
 *   estiverem dentro da idade maxima e dos tetos de quantidade/tamanho;
 * - snapshots orfaos (nenhuma entrada preservada aponta para eles) sao removidos;
 * - snapshots expirados por idade sao removidos (referenciados ou nao);
 * - ao exceder os tetos, os snapshots mais antigos sao descartados primeiro.
 */
export async function limparSnapshots(
  opcoes: OpcoesLimpezaSnapshots = {}
): Promise<ResultadoLimpezaSnapshots> {
  const snapDir = opcoes.snapDir ?? SNAP_DIR;
  const politica = opcoes.politica ?? POLITICA_SNAPSHOTS_PADRAO;
  const logFiles = opcoes.logFiles ?? arquivosDeMemoria(LOG_FILE, EVENTOS_FILE);
  const agora = opcoes.agora ?? Date.now();

  const referenciados = await coletarSnapshotsReferenciados(logFiles);

  let arquivos: ArquivoSnapshot[];
  try {
    arquivos = await listarSnapshots(snapDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { removidos: 0, mantidos: 0, bytesLiberados: 0, erros: [] };
    }
    return { removidos: 0, mantidos: 0, bytesLiberados: 0, erros: [(err as Error).message] };
  }
  for (const arquivo of arquivos) {
    arquivo.referenciado = referenciados.has(arquivo.nome);
  }

  const remover = new Set<string>();
  for (const arquivo of arquivos) {
    const orfao = !arquivo.referenciado;
    const expirado = politica.maxAgeMs > 0 && agora - arquivo.mtimeMs > politica.maxAgeMs;
    if (orfao || expirado) remover.add(arquivo.nome);
  }

  // Aplica os tetos de quantidade/tamanho sobre o que sobrou, mantendo os mais
  // novos e descartando os mais antigos quando necessario.
  const sobreviventes = arquivos
    .filter((a) => !remover.has(a.nome))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  let mantidos = 0;
  let bytesMantidos = 0;
  for (const arquivo of sobreviventes) {
    const estouraCount = politica.maxFiles > 0 && mantidos + 1 > politica.maxFiles;
    const estouraBytes =
      politica.maxBytes > 0 && bytesMantidos + arquivo.tamanho > politica.maxBytes;
    if (estouraCount || estouraBytes) {
      remover.add(arquivo.nome);
      continue;
    }
    mantidos += 1;
    bytesMantidos += arquivo.tamanho;
  }

  let removidos = 0;
  let bytesLiberados = 0;
  const erros: string[] = [];
  for (const arquivo of arquivos) {
    if (!remover.has(arquivo.nome)) continue;
    try {
      await fs.promises.unlink(arquivo.caminho);
      removidos += 1;
      bytesLiberados += arquivo.tamanho;
    } catch (err) {
      erros.push(`${arquivo.nome}: ${(err as Error).message}`);
    }
  }

  return { removidos, mantidos, bytesLiberados, erros };
}

let ultimaLimpezaSnapshotsMs = 0;

/**
 * Dispara a limpeza de forma oportunista (apos gravar snapshots), no maximo uma
 * vez por `SNAP_CLEAN_INTERVAL_MS`, sem manter o processo vivo nem bloquear a
 * resposta da requisicao.
 */
function agendarLimpezaSnapshots(
  snapDir: string,
  logFile: string,
  eventosFile: string
): void {
  const agora = Date.now();
  if (agora - ultimaLimpezaSnapshotsMs < SNAP_CLEAN_INTERVAL_MS) return;
  ultimaLimpezaSnapshotsMs = agora;
  void limparSnapshots({ snapDir, logFiles: arquivosDeMemoria(logFile, eventosFile) })
    .then((resultado) => {
      if (resultado.removidos > 0) {
        logEvent("info", "snapshots_limpos", {
          removidos: resultado.removidos,
          bytesLiberados: resultado.bytesLiberados,
        });
      }
      if (resultado.erros.length > 0) {
        logEvent("warn", "snapshots_limpeza_parcial", { erros: resultado.erros });
      }
    })
    .catch((err) => {
      logEvent("warn", "limpeza_snapshots_falhou", { erro: (err as Error).message });
    });
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
  snapDir: string,
  eventosFile: string
): Promise<void> {
  try {
    const raw = await readBody(req, BODY_MAX_BYTES);
    const payload: unknown = JSON.parse(raw || "{}");
    const erro = validarPayloadLog(payload);
    if (erro) {
      sendJson(res, 400, { ok: false, erro });
      return;
    }
    const entry = montarEntrada(payload);
    const p = (typeof payload === "object" && payload !== null ? payload : {}) as Record<
      string,
      unknown
    >;
    const snapshot = await salvarSnapshot(p.snapshot, snapDir);
    if (snapshot) entry.snapshot = snapshot;
    await appendLogEntry(entry, logFile);
    if (snapshot) agendarLimpezaSnapshots(snapDir, logFile, eventosFile);
    sendJson(res, 200, { ok: true, entrada: entry });
  } catch (err) {
    sendJson(res, 400, { ok: false, erro: (err as Error).message });
  }
}

/** Valida o payload de um evento estruturado vindo do cliente. */
export function validarPayloadEvento(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return "payload deve ser um objeto";
  }
  const p = payload as Record<string, unknown>;
  const erroTipo = campoTipoTexto(p.descricao, "descricao");
  if (erroTipo) return erroTipo;
  if (typeof p.descricao !== "string" || !p.descricao) return "campo 'descricao' obrigatorio";
  if (typeof p.tipo !== "string") return "campo 'tipo' obrigatorio";
  if (typeof p.origem !== "string") return "campo 'origem' obrigatorio";
  return null;
}

async function handleEventos(
  req: IncomingMessage,
  res: ServerResponse,
  eventosFile: string,
  snapDir: string,
  logFile: string
): Promise<void> {
  try {
    const raw = await readBody(req, BODY_MAX_BYTES);
    const payload: unknown = JSON.parse(raw || "{}");
    const erro = validarPayloadEvento(payload);
    if (erro) {
      sendJson(res, 400, { ok: false, erro });
      return;
    }
    const evento = montarEvento(payload);
    if (!evento) {
      sendJson(res, 400, { ok: false, erro: "evento invalido (tipo ou origem desconhecidos)" });
      return;
    }
    const p = payload as Record<string, unknown>;
    const snapshot = await salvarSnapshot(p.snapshot, snapDir);
    if (snapshot) evento.snapshot = snapshot;
    await appendEvento(evento, eventosFile);
    if (snapshot) agendarLimpezaSnapshots(snapDir, logFile, eventosFile);
    sendJson(res, 200, { ok: true, evento });
  } catch (err) {
    sendJson(res, 400, { ok: false, erro: (err as Error).message });
  }
}

async function handleListEventos(
  req: IncomingMessage,
  res: ServerResponse,
  eventosFile: string
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/api/eventos", "http://localhost");
    const limitParam = Number(url.searchParams.get("limit"));
    const limite = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 500) : 100;
    // Filtros (Fase 4): "o que mudou" (`tipo`/`objetoId`) e "quando"
    // (`desde`/`ate`, aceitando epoch ms ou ISO). Aplicados aos eventos mais
    // recentes dentro de `limit`.
    const eventos = filtrarEventos(await lerEventos(eventosFile, limite), {
      tipos: parsearTiposEvento(url.searchParams.get("tipo")),
      objetoId: url.searchParams.get("objetoId")?.trim() || undefined,
      desdeMs: parsearInstante(url.searchParams.get("desde")),
      ateMs: parsearInstante(url.searchParams.get("ate")),
    });
    sendJson(res, 200, { ok: true, total: eventos.length, eventos });
  } catch (err) {
    logEvent("error", "listar_eventos_falhou", { erro: (err as Error).message });
    sendJson(res, 500, { ok: false, erro: (err as Error).message });
  }
}

async function handleClearEventos(
  res: ServerResponse,
  eventosFile: string,
  snapDir: string,
  logFile: string
): Promise<void> {
  try {
    await limparEventos(eventosFile);
    const snapshots = await limparSnapshots({
      snapDir,
      logFiles: arquivosDeMemoria(logFile, eventosFile),
    });
    sendJson(res, 200, { ok: true, snapshots });
  } catch (err) {
    logEvent("error", "limpar_eventos_falhou", { erro: (err as Error).message });
    sendJson(res, 500, { ok: false, erro: (err as Error).message });
  }
}

function inteiroLimitado(valor: string | null, padrao: number, min: number, max: number): number {
  const n = Number(valor);
  if (!Number.isFinite(n)) return padrao;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

/**
 * Le um instante de um parametro de query: aceita epoch ms (`"1728000000000"`)
 * ou data ISO (`"2026-10-11T00:00:00Z"`). Retorna `undefined` quando ausente ou
 * invalido, para o filtro correspondente nao restringir o resultado.
 */
export function parsearInstante(valor: string | null): number | undefined {
  if (valor === null) return undefined;
  const texto = valor.trim();
  if (!texto) return undefined;
  const numero = Number(texto);
  if (Number.isFinite(numero)) return numero;
  const data = Date.parse(texto);
  return Number.isFinite(data) ? data : undefined;
}

/** Le a lista de tipos de evento de `?tipo=aparicao,movimento`, descartando invalidos. */
export function parsearTiposEvento(valor: string | null): TipoEventoVisual[] {
  if (!valor) return [];
  const tipos = valor
    .split(",")
    .map((t) => normalizarTipoEvento(t.trim()))
    .filter((t): t is TipoEventoVisual => t !== null);
  return [...new Set(tipos)];
}

/**
 * `GET /api/contexto` — reconstroi um contexto curto do estado recente a partir
 * do historico e dos eventos persistidos, com janelas limitadas por tamanho e
 * contagem para nao enviar indefinidamente todo o historico ao modelo.
 */
async function handleContexto(
  req: IncomingMessage,
  res: ServerResponse,
  logFile: string,
  eventosFile: string
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/api/contexto", "http://localhost");
    const maxEntradas = inteiroLimitado(url.searchParams.get("maxEntradas"), 20, 1, 200);
    const maxEventos = inteiroLimitado(url.searchParams.get("maxEventos"), 20, 0, 200);
    const maxCaracteres = inteiroLimitado(url.searchParams.get("maxCaracteres"), 1200, 200, 8000);
    const entradas = await lerLogEntries(logFile, maxEntradas);
    const eventos = await lerEventos(eventosFile, maxEventos);
    const contexto = reidratarContexto(entradas, eventos, {
      maxEntradas,
      maxEventos,
      maxCaracteres,
    });
    sendJson(res, 200, { ok: true, ...contexto });
  } catch (err) {
    logEvent("error", "contexto_falhou", { erro: (err as Error).message });
    sendJson(res, 500, { ok: false, erro: (err as Error).message });
  }
}

async function handleOperacional(
  req: IncomingMessage,
  res: ServerResponse,
  operacionalFile: string
): Promise<void> {
  try {
    const raw = await readBody(req, BODY_MAX_BYTES);
    const payload: unknown = JSON.parse(raw || "{}");
    const registro = montarOperacional(payload);
    if (!registro) {
      sendJson(res, 400, { ok: false, erro: "campo 'mensagem' obrigatorio" });
      return;
    }
    await appendOperacional(registro, operacionalFile);
    sendJson(res, 200, { ok: true, registro });
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
    motivo?: MotivoAnalise;
  },
  logFile: string,
  snapDir: string,
  eventosFile: string,
  snapshot: unknown
): Promise<void> {
  // Se o cliente desconectar (cancelar/fechar a pagina), aborta o fetch do
  // Ollama em vez de deixar a inferencia continuar consumindo recursos.
  const controle = new AbortController();
  res.once("close", () => controle.abort());
  const iterador = gerarDescricaoStream(imagem, { ...opcoes, signal: controle.signal });
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
      motivo: opcoes.motivo,
    };
    const snap = await salvarSnapshot(snapshot, snapDir);
    if (snap) entry.snapshot = snap;
    await appendLogEntry(entry, logFile);
    if (snap) agendarLimpezaSnapshots(snapDir, logFile, eventosFile);

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
        motivo: entry.motivo,
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
    const raw = await readBody(req, VISAO_BODY_MAX_BYTES);
    payload = JSON.parse(raw || "{}");
  } catch (err) {
    sendJson(res, 400, { ok: false, erro: (err as Error).message });
    return;
  }

  const erroPayload = validarPayloadVisao(payload);
  if (erroPayload) {
    sendJson(res, 400, { ok: false, erro: erroPayload });
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
        motivo: normalizarMotivo(p.motivo),
      },
      config.logFile ?? LOG_FILE,
      config.snapDir ?? SNAP_DIR,
      config.eventosFile ?? EVENTOS_FILE,
      p.snapshot
    );
  } catch (err) {
    // Cancelamento (cliente desconectou/fechou a pagina) nao e falha: o fetch
    // do Ollama foi abortado de proposito. Registra explicitamente para o
    // diagnostico, sem responder a um cliente que ja foi embora.
    if (ehCancelamento(err)) {
      logEvent("info", "visao_cancelada", { cancelada: true });
      if (!res.writableEnded && res.headersSent) res.end();
      return;
    }
    const mensagem = (err as Error).message;
    const timeout = (err as Error).name === "TimeoutError";
    const status = err instanceof TypeError || err instanceof ErroOllama ? 502 : 500;
    logEvent("error", timeout ? "visao_timeout" : "visao_falhou", { status, erro: mensagem, timeout });
    if (!res.headersSent) {
      sendJson(res, status, { ok: false, erro: timeout ? `Ollama: tempo esgotado — ${mensagem}` : "Ollama: " + mensagem });
    } else {
      res.write(JSON.stringify({ type: "erro", erro: (timeout ? "Ollama: tempo esgotado — " : "Ollama: ") + mensagem }) + "\n");
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

async function handleClearLogs(
  res: ServerResponse,
  logFile: string,
  snapDir: string,
  eventosFile: string
): Promise<void> {
  try {
    await limparLog(logFile);
    await limparEventos(eventosFile);
    // Sem historico nem eventos, todos os snapshots ficam orfaos: a limpeza os
    // remove de imediato, mantendo o uso de disco limitado pela politica.
    const snapshots = await limparSnapshots({
      snapDir,
      logFiles: arquivosDeMemoria(logFile, eventosFile),
    });
    sendJson(res, 200, { ok: true, snapshots });
  } catch (err) {
    logEvent("error", "limpar_logs_falhou", { erro: (err as Error).message });
    sendJson(res, 500, { ok: false, erro: (err as Error).message });
  }
}

interface InfoOllama {
  online: boolean;
  /** Modelo de visao solicitado ao Ollama (OLLAMA_MODEL ou o padrao). */
  modelo: string;
  modelos: string[];
  carregados: string[];
  erro: string;
}

async function consultarOllama(host?: string): Promise<InfoOllama> {
  const base = (host ?? process.env.OLLAMA_HOST ?? "http://localhost:11434").replace(/\/+$/, "");
  const modelo = process.env.OLLAMA_MODEL ?? MODELO_PADRAO;
  try {
    const resposta = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!resposta.ok) return { online: false, modelo, modelos: [], carregados: [], erro: `HTTP ${resposta.status}` };
    const dados = (await resposta.json()) as { models?: { name?: string }[] };
    const modelos = (dados.models ?? [])
      .map((m) => m.name ?? "")
      .filter((n) => n.length > 0);
    const carregados = await modelosEmMemoria({ host: base, timeoutMs: 3000 });
    return { online: true, modelo, modelos, carregados, erro: "" };
  } catch (err) {
    return { online: false, modelo, modelos: [], carregados: [], erro: (err as Error).message };
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
  /** Arquivo de eventos estruturados. Padrao: `eventos.jsonl` ao lado do log. */
  eventosFile?: string;
  /** Arquivo de registros operacionais. Padrao: `operacional.jsonl` ao lado do log. */
  operacionalFile?: string;
}

export function createServer(config: ServerConfig = {}): http.Server {
  const logFile = config.logFile ?? LOG_FILE;
  const snapDir = config.snapDir ?? SNAP_DIR;
  const publicDir = config.publicDir ?? PUBLIC_DIR;
  const eventosFile = config.eventosFile ?? path.join(path.dirname(logFile), "eventos.jsonl");
  const operacionalFile =
    config.operacionalFile ?? path.join(path.dirname(logFile), "operacional.jsonl");
  const permitidas = origensPermitidas(process.env.NEURO_ALLOWED_ORIGINS);

  return http.createServer((req, res) => {
    const url = req.url ?? "/";
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
      void handleListEventos(req, res, eventosFile);
      return;
    }
    if (req.method === "DELETE" && pathname === "/api/eventos") {
      void handleClearEventos(res, eventosFile, snapDir, logFile);
      return;
    }
    if (req.method === "POST" && url === "/api/operacional") {
      void handleOperacional(req, res, operacionalFile);
      return;
    }
    if (req.method === "GET" && pathname === "/api/contexto") {
      void handleContexto(req, res, logFile, eventosFile);
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
      void handleClearLogs(res, logFile, snapDir, eventosFile);
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
  if (hostExpostoNaRede(HOST) && process.env.NEURO_ALLOW_REMOTE !== "1") {
    logEvent("error", "bind_remoto_bloqueado", { host: HOST });
    console.error(
      `\n  HOST=${HOST} expoe a interface e a API a rede local, sem autenticacao.\n` +
        `  Use HOST=127.0.0.1 (padrao) ou defina NEURO_ALLOW_REMOTE=1 para assumir o risco.\n` +
        `  Ao expor, restrinja o acesso (firewall/reverse proxy com autenticacao) e limite as origens com NEURO_ALLOWED_ORIGINS.\n`
    );
    process.exit(1);
  }
  if (hostExpostoNaRede(HOST)) {
    logEvent("warn", "bind_remoto_habilitado", { host: HOST });
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
    .catch((err) => logEvent("warn", "limpeza_snapshots_falhou", { erro: (err as Error).message }));
  createServer().listen(PORT, HOST, () => {
    logEvent("info", "servidor_iniciado", { host: HOST, port: PORT, logFile: LOG_FILE });
    console.log(`\n  Neuro Vision rodando em http://${HOST}:${PORT}`);
    console.log(`  Logs em: ${LOG_FILE}\n`);
  });
}
