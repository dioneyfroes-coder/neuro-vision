import { createHash } from "node:crypto";
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ErroVisao,
  escolherModelo,
  forcarCarregamento,
  gerarDescricaoStream,
  melhorModeloDisponivel,
  mesmoModelo,
  memoriaIntrospectavel,
  modeloEmMemoria,
  modelosEmMemoria,
  MODELO_PADRAO,
  traduzirTexto,
  deveTraduzir,
  type ModoAnalise,
} from "./visao";
import { cabecalhos, resolverBackend, urlModelos } from "./provedor";
import { colapsarRepeticoes, cortarFraseIncompleta, ehSemMudanca } from "./texto";
import { ehCancelamento } from "./erros";
import {
  filtrarEventos,
  montarEvento,
  montarOperacional,
  normalizarTipoEvento,
  reidratarContexto,
} from "./memoria";
import type { RegistroOperacional } from "./memoria";
import type { RegistroCiclo } from "./domain/cycle";
// Persistencia (Etapa 8): o servidor HTTP compoe os repositorios; a gravacao e a
// leitura de observacoes, eventos, registros operacionais e ciclos ficam em
// `src/persistence/`, sem conhecer as rotas.
import {
  gravarObservacao,
  lerObservacoes,
  limparObservacoes,
} from "./persistence/repositorio-observacoes";
import {
  eventoJaRegistrado,
  gravarEvento,
  lerEventos as lerEventosRepo,
  limparEventos as limparEventosRepo,
  marcarEventoRegistrado,
} from "./persistence/repositorio-eventos";
export { eventoJaRegistrado, marcarEventoRegistrado } from "./persistence/repositorio-eventos";
import {
  gravarOperacional,
  lerOperacional as lerOperacionalRepo,
} from "./persistence/repositorio-operacional";
import {
  gravarCiclo,
  lerCiclos as lerCiclosRepo,
  limparCiclos,
} from "./persistence/repositorio-ciclos";
import type {
  Caixa,
  EntradaLog,
  EventoVisual,
  MarcacaoNsfwLog,
  MotivoAnalise,
  ObjetoVisto,
  TipoEntrada,
  TipoEventoVisual,
} from "./types";
import { normalizarCaixaNsfw } from "./nsfw-prompt";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
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
export const OPERACIONAL_FILE = path.join(LOG_DIR, "operacional.jsonl");
export const CICLOS_FILE = path.join(LOG_DIR, "ciclos.jsonl");
import { env } from "./env";
export const LOG_MAX_BYTES = env.LOG_MAX_BYTES || 5_000_000;
export const SNAP_DIR = path.join(LOG_DIR, "snapshots");
const SNAP_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

interface SnapshotCacheEntry {
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
/** Limite de um unico snapshot (data URL/base64) aceito para gravacao. */
export function limiteUploadSnapshot(): number {
  return env.SNAP_UPLOAD_MAX_BYTES;
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
  ".onnx": "application/octet-stream",
  ".task": "application/octet-stream",
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

/**
 * Normaliza marcacoes NSFW recebidas do cliente.
 *
 * O cliente ja envia caixas normalizadas; aqui apenas validamos tipos e
 * limitamos score/caixa a [0, 1]. Uma lista vazia e preservada (o subsistema
 * rodou e nao encontrou nada), enquanto `undefined` significa desligado.
 */
function normalizarMarcacoesNsfw(valor: unknown): MarcacaoNsfwLog[] | undefined {
  if (valor === undefined || valor === null) return undefined;
  if (!Array.isArray(valor)) return undefined;
  const marcacoes: MarcacaoNsfwLog[] = [];
  for (const item of valor) {
    if (typeof item !== "object" || item === null) continue;
    const m = item as Record<string, unknown>;
    if (typeof m.rotulo !== "string" || m.rotulo.length === 0) continue;
    const score = campoNumero(m.score);
    marcacoes.push({
      rotulo: m.rotulo,
      score: score === undefined ? 0 : Math.min(1, Math.max(0, score)),
      caixa: normalizarCaixaNsfw(normalizarCaixa(m.caixa)),
    });
  }
  return marcacoes;
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
    capturadoEm: typeof p.capturadoEm === "string" ? p.capturadoEm : undefined,
    ms: campoNumero(p.ms),
    tokens: campoNumero(p.tokens),
    motivo: normalizarMotivo(p.motivo),
    sessaoId: typeof p.sessaoId === "string" ? p.sessaoId : undefined,
    frameId: typeof p.frameId === "string" ? p.frameId : undefined,
    nsfw: normalizarMarcacoesNsfw(p.nsfw),
  };
}

export async function appendLogEntry(entry: EntradaLog, filePath: string = LOG_FILE): Promise<void> {
  await gravarObservacao(entry, filePath, LOG_MAX_BYTES);
}

export async function lerLogEntries(
  filePath: string = LOG_FILE,
  limit = 100
): Promise<EntradaLog[]> {
  return lerObservacoes(filePath, limit);
}

export async function limparLog(filePath: string = LOG_FILE): Promise<void> {
  await limparObservacoes(filePath);
}

export async function appendEvento(
  evento: EventoVisual,
  filePath: string = EVENTOS_FILE
): Promise<void> {
  await gravarEvento(evento, filePath, LOG_MAX_BYTES);
}

export async function lerEventos(
  filePath: string = EVENTOS_FILE,
  limit = 100
): Promise<EventoVisual[]> {
  return lerEventosRepo(filePath, limit);
}

export async function limparEventos(filePath: string = EVENTOS_FILE): Promise<void> {
  await limparEventosRepo(filePath);
}

export async function appendOperacional(
  registro: RegistroOperacional,
  filePath: string = OPERACIONAL_FILE
): Promise<void> {
  await gravarOperacional(registro, filePath, LOG_MAX_BYTES);
}

export async function lerOperacional(
  filePath: string = OPERACIONAL_FILE,
  limit = 100
): Promise<RegistroOperacional[]> {
  return lerOperacionalRepo(filePath, limit);
}

/** Grava o registro de diagnostico de um ciclo (Etapa 8). */
export async function appendCiclo(
  registro: RegistroCiclo,
  filePath: string = CICLOS_FILE
): Promise<void> {
  await gravarCiclo(registro, filePath, LOG_MAX_BYTES);
}

/** Le os registros de ciclo mais recentes (mais recente primeiro). */
export async function lerCiclos(
  filePath: string = CICLOS_FILE,
  limit = 100
): Promise<RegistroCiclo[]> {
  return lerCiclosRepo(filePath, limit);
}

/** Esvazia os registros de ciclo persistidos. */
export async function limparCiclosPersistidos(filePath: string = CICLOS_FILE): Promise<void> {
  await limparCiclos(filePath);
}

type SubsistemaIndisponivel = RegistroCiclo["subsistemasIndisponiveis"][number];
const SUBSISTEMAS_VALIDOS: SubsistemaIndisponivel[] = ["deteccao", "pose", "maos", "nsfw"];

/**
 * Normaliza o corpo de `POST /api/ciclos` em um `RegistroCiclo`. O registro
 * chega pronto do cliente (derivado com `criarRegistroCiclo`); aqui apenas
 * garantimos os campos essenciais e descartamos o que vier com tipo errado.
 */
export function montarRegistroCiclo(payload: unknown): RegistroCiclo | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.sessionId !== "string" || !p.sessionId) return null;
  if (typeof p.cycleId !== "string" || !p.cycleId) return null;
  const frameIds = Array.isArray(p.frameIds)
    ? p.frameIds.filter((id): id is string => typeof id === "string")
    : [];
  const erros = Array.isArray(p.erros) ? (p.erros as RegistroCiclo["erros"]) : [];
  const subsistemas = Array.isArray(p.subsistemasIndisponiveis)
    ? p.subsistemasIndisponiveis.filter((s): s is SubsistemaIndisponivel =>
        SUBSISTEMAS_VALIDOS.includes(s as SubsistemaIndisponivel)
      )
    : [];
  const metricas =
    typeof p.metricas === "object" && p.metricas !== null
      ? (p.metricas as RegistroCiclo["metricas"])
      : {};
  return {
    sessionId: p.sessionId,
    cycleId: p.cycleId,
    iniciadoEm: typeof p.iniciadoEm === "string" ? p.iniciadoEm : new Date().toISOString(),
    concluidoEm: typeof p.concluidoEm === "string" ? p.concluidoEm : undefined,
    frameIds,
    observacoes: typeof p.observacoes === "number" ? p.observacoes : frameIds.length,
    eventosTemporais: typeof p.eventosTemporais === "number" ? p.eventosTemporais : 0,
    subsistemasIndisponiveis: subsistemas,
    erros,
    metricas,
    interpretacao: typeof p.interpretacao === "string" ? p.interpretacao : undefined,
    cancelado: p.cancelado === true,
    registroEm: typeof p.registroEm === "string" ? p.registroEm : new Date().toISOString(),
  };
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
  const hash = createHash("sha256").update(b64).digest("hex");
  limparCacheSnapshots(Date.now());
  // A chave inclui o diretorio: o mesmo conteudo gravado em pastas diferentes
  // aponta para arquivos diferentes.
  const chave = `${snapDir}\u0000${hash}`;
  const existente = snapshotCache.get(chave);
  if (existente) {
    snapshotCache.set(chave, { ...existente, ts: Date.now() });
    return existente.url;
  }
  // Se por acaso ja existe arquivo com mesmo hash? evita duplicar fisicamente
  const nome = `${Date.now()}-${hash.slice(0, 8)}.jpg`;
  await fs.promises.writeFile(path.join(snapDir, nome), Buffer.from(b64, "base64"));
  const url = `${SNAP_URL}/${nome}`;
  snapshotCache.set(chave, { url, hash, ts: Date.now() });
  return url;
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
  if (p.nsfw !== undefined && !Array.isArray(p.nsfw)) {
    return "campo 'nsfw' deve ser uma lista";
  }
  const texto =
    campoTipoTexto(p.resumo, "resumo") ??
    campoTipoTexto(p.modelo, "modelo") ??
    campoTipoTexto(p.capturadoEm, "capturadoEm");
  if (texto) return texto;
  return validarSnapshot(p.snapshot);
}

/** Valida uma lista de imagens (data URL/base64) para `POST /api/visao`. */
function validarListaImagens(valor: unknown): string | null {
  if (valor === undefined || valor === null) return null;
  if (!Array.isArray(valor)) return "campo 'imagens' deve ser uma lista";
  if (valor.length === 0) return "campo 'imagens' nao pode ser vazio";
  for (let i = 0; i < valor.length; i += 1) {
    const item = valor[i];
    if (typeof item !== "string" || item.length === 0) {
      return `campo 'imagens[${i}]' deve ser texto (data URL)`;
    }
  }
  return null;
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
    campoTipoTexto(p.roteiro, "roteiro") ??
    campoTipoTexto(p.prompt, "prompt") ??
    campoTipoTexto(p.capturadoEm, "capturadoEm");
  if (texto) return texto;
  const erroImagens = validarListaImagens(p.imagens);
  if (erroImagens) return erroImagens;
  if (p.nsfw !== undefined && !Array.isArray(p.nsfw)) {
    return "campo 'nsfw' deve ser uma lista";
  }
  if (p.motivo !== undefined && p.motivo !== null && !normalizarMotivo(p.motivo)) {
    return "campo 'motivo' tem valor invalido";
  }
  return validarSnapshot(p.snapshot);
}

/** Extrai a lista de imagens do payload (`imagens[]` ou `imagem` singular). */
function extrairImagens(p: Record<string, unknown>): string[] {
  if (Array.isArray(p.imagens)) {
    return p.imagens.filter((v): v is string => typeof v === "string" && v.length > 0);
  }
  return typeof p.imagem === "string" && p.imagem.length > 0 ? [p.imagem] : [];
}

interface ArquivoSnapshot {
  nome: string;
  caminho: string;
  tamanho: number;
  mtimeMs: number;
  referenciado: boolean;
}

export interface OpcoesLimpezaSnapshots {
  snapDir?: string;
  logFiles?: string[];
  politica?: PoliticaSnapshots;
  agora?: number;
}

export interface ResultadoLimpezaSnapshots {
  removidos: number;
  mantidos: number;
  bytesLiberados: number;
  erros: string[];
}

const snapshotCache = new Map<string, SnapshotCacheEntry>();

function limparCacheSnapshots(agora = Date.now()): void {
  for (const [chave, entrada] of snapshotCache) {
    if (agora - entrada.ts > SNAP_CACHE_TTL_MS) snapshotCache.delete(chave);
  }
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
    // Idempotencia (Fase 6C): o reenvio da mesma requisicao pela fila do cliente
    // nao acrescenta um evento duplicado nem regrava o snapshot.
    const chave = evento.idempotencyKey;
    if (chave && eventoJaRegistrado(eventosFile, chave)) {
      sendJson(res, 200, { ok: true, evento, duplicado: true });
      return;
    }
    const p = payload as Record<string, unknown>;
    const snapshot = await salvarSnapshot(p.snapshot, snapDir);
    if (snapshot) evento.snapshot = snapshot;
    await appendEvento(evento, eventosFile);
    if (chave) marcarEventoRegistrado(eventosFile, chave);
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

/**
 * `POST /api/ciclos` — grava o diagnostico de um ciclo (metricas por etapa,
 * erros, subsistemas indisponiveis e relacoes sessao/ciclo/frames). Um ciclo
 * incompleto continua registravel: o erro fica no proprio registro.
 */
async function handleCiclos(
  req: IncomingMessage,
  res: ServerResponse,
  ciclosFile: string
): Promise<void> {
  try {
    const raw = await readBody(req, BODY_MAX_BYTES);
    const payload: unknown = JSON.parse(raw || "{}");
    const registro = montarRegistroCiclo(payload);
    if (!registro) {
      sendJson(res, 400, { ok: false, erro: "campos 'sessionId' e 'cycleId' obrigatorios" });
      return;
    }
    await appendCiclo(registro, ciclosFile);
    sendJson(res, 200, { ok: true, ciclo: registro });
  } catch (err) {
    sendJson(res, 400, { ok: false, erro: (err as Error).message });
  }
}

/** `GET /api/ciclos` — lista os diagnosticos de ciclo mais recentes. */
async function handleListCiclos(
  req: IncomingMessage,
  res: ServerResponse,
  ciclosFile: string
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/api/ciclos", "http://localhost");
    const limitParam = Number(url.searchParams.get("limit"));
    const limite = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 500) : 50;
    const ciclos = await lerCiclos(ciclosFile, limite);
    sendJson(res, 200, { ok: true, total: ciclos.length, ciclos });
  } catch (err) {
    logEvent("error", "listar_ciclos_falhou", { erro: (err as Error).message });
    sendJson(res, 500, { ok: false, erro: (err as Error).message });
  }
}

/** `DELETE /api/ciclos` — esvazia os diagnosticos de ciclo persistidos. */
async function handleClearCiclos(res: ServerResponse, ciclosFile: string): Promise<void> {
  try {
    await limparCiclosPersistidos(ciclosFile);
    sendJson(res, 200, { ok: true });
  } catch (err) {
    logEvent("error", "limpar_ciclos_falhou", { erro: (err as Error).message });
    sendJson(res, 500, { ok: false, erro: (err as Error).message });
  }
}

async function streamVisao(
  res: ServerResponse,
  imagem: string | string[],
  opcoes: {
    modelo?: string;
    baseUrl?: string;
    anterior?: string;
    prompt?: string;
    modo?: ModoAnalise;
    roteiro?: string;
    base?: boolean;
    motivo?: MotivoAnalise;
    capturadoEm?: string;
    /** Marcacoes NSFW normalizadas; `undefined` = subsistema desligado. */
    nsfw?: MarcacaoNsfwLog[];
    apiKey?: string;
  },
  logFile: string,
  snapDir: string,
  eventosFile: string,
  snapshot: unknown
): Promise<void> {
  // Se o cliente desconectar (cancelar/fechar a pagina), aborta o fetch do
  // backend de visao em vez de deixar a inferencia continuar consumindo recursos.
  const controle = new AbortController();
  res.once("close", () => controle.abort());
  const iterador = gerarDescricaoStream(imagem, { ...opcoes, signal: controle.signal });
  const primeiro = await iterador.next();
  if (primeiro.done) {
    throw new Error(
      "O backend de visao retornou um stream vazio (nenhum texto). Verifique se o modelo suporta visao e aumente num_predict/max_tokens."
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
  let limpo = colapsarRepeticoes(cortarFraseIncompleta(texto));
  const tipo: TipoEntrada = opcoes.modo === "roteiro" ? "roteiro" : "descricao";
  const papel = opcoes.modo === "roteiro" ? (opcoes.base === true ? "base" : "delta") : undefined;
  const semMudanca = papel === "delta" && ehSemMudanca(limpo);

  if (!semMudanca) {
    if (deveTraduzir(limpo)) {
      const traduzido = await traduzirTexto({
        texto: limpo,
        baseUrl: opcoes.baseUrl,
        apiKey: opcoes.apiKey,
      });
      if (traduzido && traduzido !== limpo) {
        limpo = traduzido;
      }
    }
    const entry: EntradaLog = {
      timestamp: new Date().toISOString(),
      modelo: resumo.modelo,
      objetos: [],
      resumo: limpo,
      tipo,
      papel,
      capturadoEm: opcoes.capturadoEm,
      ms: resumo.duracaoMs,
      tokens: resumo.tokens,
      motivo: opcoes.motivo,
      nsfw: opcoes.nsfw,
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
        nsfw: entry.nsfw,
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
  const imagens = extrairImagens(p);
  if (imagens.length === 0) {
    sendJson(res, 400, { ok: false, erro: "campo 'imagem' ou 'imagens' obrigatorio (base64)" });
    return;
  }

  const escolha =
    typeof p.modelo === "string"
      ? { solicitado: p.modelo, modelo: p.modelo, alternativo: false }
      : await escolherModelo({ baseUrl: config.backendUrl });
  if (escolha.alternativo) {
    logEvent("info", "modelo_fallback", {
      solicitado: escolha.solicitado,
      modelo: escolha.modelo,
    });
  }

  try {
    await streamVisao(
      res,
      imagens,
      {
        modelo: escolha.modelo,
        baseUrl: config.backendUrl,
        apiKey: config.apiKey,
        anterior: typeof p.anterior === "string" ? p.anterior : undefined,
        prompt: typeof p.prompt === "string" && p.prompt.trim() ? p.prompt : undefined,
        modo: p.modo === "roteiro" ? "roteiro" : "descricao",
        roteiro: typeof p.roteiro === "string" ? p.roteiro : undefined,
        base: p.base === true,
        motivo: normalizarMotivo(p.motivo),
        capturadoEm: typeof p.capturadoEm === "string" ? p.capturadoEm : undefined,
        nsfw: normalizarMarcacoesNsfw(p.nsfw),
      },
      config.logFile ?? LOG_FILE,
      config.snapDir ?? SNAP_DIR,
      config.eventosFile ?? EVENTOS_FILE,
      p.snapshot
    );
  } catch (err) {
    // Cancelamento (cliente desconectou/fechou a pagina) nao e falha: o fetch
    // do backend foi abortado de proposito. Registra explicitamente para o
    // diagnostico, sem responder a um cliente que ja foi embora.
    if (ehCancelamento(err)) {
      logEvent("info", "visao_cancelada", { cancelada: true });
      if (!res.writableEnded && res.headersSent) res.end();
      return;
    }
    const mensagem = (err as Error).message;
    const timeout = (err as Error).name === "TimeoutError";
    const status = err instanceof TypeError || err instanceof ErroVisao ? 502 : 500;
    logEvent("error", timeout ? "visao_timeout" : "visao_falhou", { status, erro: mensagem, timeout });
    if (!res.headersSent) {
      sendJson(res, status, { ok: false, erro: timeout ? `Backend: tempo esgotado — ${mensagem}` : "Backend: " + mensagem });
    } else {
      res.write(JSON.stringify({ type: "erro", erro: (timeout ? "Backend: tempo esgotado — " : "Backend: ") + mensagem }) + "\n");
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
  eventosFile: string,
  ciclosFile: string
): Promise<void> {
  try {
    // "Limpar historico" apaga os dados persistidos: observacoes, eventos,
    // diagnosticos de ciclo e os snapshots que ficaram orfaos. Nao mexe no
    // estado temporal em memoria do cliente — esse reset e uma acao separada.
    await limparLog(logFile);
    await limparEventos(eventosFile);
    await limparCiclosPersistidos(ciclosFile);
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

interface InfoVisao {
  online: boolean;
  /** Modelo de visao configurado (NEURO_MODEL ou o padrao). */
  solicitado: string;
  /** Modelo efetivamente usado (o solicitado ou o melhor disponivel). */
  modelo: string;
  modelos: string[];
  carregados: string[];
  erro: string;
}

async function consultarVisao(baseUrl?: string): Promise<InfoVisao> {
  const backend = resolverBackend({ baseUrl });
  const solicitado = env.NEURO_MODEL !== "" ? env.NEURO_MODEL : MODELO_PADRAO;
  try {
    const resposta = await fetch(urlModelos(backend), {
      headers: cabecalhos(backend),
      signal: AbortSignal.timeout(3000),
    });
    if (!resposta.ok) {
      return {
        online: false,
        solicitado,
        modelo: solicitado,
        modelos: [],
        carregados: [],
        erro: `HTTP ${resposta.status}`,
      };
    }
    const dados = (await resposta.json()) as {
      data?: { id?: string }[];
      models?: { id?: string }[];
    };
    const modelos = (dados.data ?? dados.models ?? []).map((m) => m.id ?? "");
    const modelosValidos = modelos.filter((n) => n.length > 0);
    // Configurado instalado? Usa ele. Senao, cai para o melhor disponivel.
    const modelo =
      modelosValidos.length === 0 || modelosValidos.some((m) => mesmoModelo(m, solicitado))
        ? solicitado
        : melhorModeloDisponivel(modelosValidos) || solicitado;
    const carregados = await modelosEmMemoria({ baseUrl, timeoutMs: 3000 });
    return {
      online: true,
      solicitado,
      modelo,
      modelos: modelosValidos,
      carregados,
      erro: "",
    };
  } catch (err) {
    return {
      online: false,
      solicitado,
      modelo: solicitado,
      modelos: [],
      carregados: [],
      erro: (err as Error).message,
    };
  }
}

async function handlePreparar(
  res: ServerResponse,
  config: ServerConfig,
  modeloPedido?: string
): Promise<void> {
  // O cliente pode pedir um modelo especifico (seletor da interface); sem ele,
  // vale o configurado no ambiente (NEURO_MODEL ou o padrao do servidor).
  const pedido = modeloPedido?.trim();
  const escolha =
    pedido && pedido.length > 0
      ? { solicitado: pedido, modelo: pedido, alternativo: false }
      : await escolherModelo({ baseUrl: config.backendUrl });
  const modelo = escolha.modelo;
  if (escolha.alternativo) {
    logEvent("info", "modelo_fallback", {
      solicitado: escolha.solicitado,
      modelo,
    });
  }
  try {
    const carregandoMs = await forcarCarregamento({
      modelo,
      baseUrl: config.backendUrl,
      apiKey: config.apiKey,
    });
    // Quando o backend nao permite consultar a memoria (ex.: LM Studio sem
    // `/api/v0/models`), a carga bem-sucedida acima ja confirma o modelo.
    const emMemoria =
      (await modeloEmMemoria({ modelo, baseUrl: config.backendUrl })) ||
      !(await memoriaIntrospectavel({ modelo, baseUrl: config.backendUrl }));
    sendJson(res, 200, { ok: true, modelo, carregado: emMemoria, carregandoMs });
    logEvent("info", "modelo_preparado", { modelo, carregandoMs, carregado: emMemoria });
  } catch (err) {
    logEvent("error", "modelo_preparacao_falhou", { modelo, erro: (err as Error).message });
    sendJson(res, 502, { ok: false, erro: "Backend: " + (err as Error).message });
  }
}

async function handleHealth(res: ServerResponse, config: ServerConfig): Promise<void> {
  const visao = await consultarVisao(config.backendUrl);
  sendJson(res, 200, { ok: true, visao });
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

/**
 * Serve os pesos NSFW experimentais de `modelos/yolonsfw/` (`.onnx` + sidecar
 * `.json` de rotulos). A pasta e gitignored: sem export, responde 404 — e o
 * cliente traduz isso em "rode scripts/exportar-yolo-nsfw.mjs".
 */
function serveModeloNsfw(req: IncomingMessage, res: ServerResponse, nsfwDir: string): void {
  const pathname = pathnameDecodificado(req.url);
  if (pathname === null) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Requisicao invalida");
    return;
  }
  const rel = pathname.replace(/^\/yolonsfw\/?/, "");
  // Somente os artefatos do export: modelo ONNX e sidecar de classes.
  if (!/^[\w.-]+\.onnx(\.json)?$/.test(rel)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Acesso negado");
    return;
  }
  const filePath = resolverCaminhoDentroDaBase(nsfwDir, rel);
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

/**
 * Serve um arquivo do **modo offline** (`vendor/` ou `modelos/`), restrito a
 * uma allowlist de extensoes. As pastas sao gitignored: sem o download
 * (`npm run preparar:offline`) a rota responde 404 e o cliente usa o CDN.
 */
function serveArquivoOffline(
  req: IncomingMessage,
  res: ServerResponse,
  baseDir: string,
  prefixo: RegExp,
  extensoes: RegExp
): void {
  const pathname = pathnameDecodificado(req.url);
  if (pathname === null) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Requisicao invalida");
    return;
  }
  const rel = pathname.replace(prefixo, "");
  if (!extensoes.test(rel)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Acesso negado");
    return;
  }
  const filePath = resolverCaminhoDentroDaBase(baseDir, rel);
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
    const cabecalhos = {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Content-Length": String(data.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
    };
    if (req.method === "HEAD") {
      res.writeHead(200, cabecalhos);
      res.end();
      return;
    }
    res.writeHead(200, cabecalhos);
    res.end(data);
  });
}

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
  /** Arquivo de registros operacionais. Padrao: `operacional.jsonl` ao lado do log. */
  operacionalFile?: string;
  /** Arquivo de diagnosticos de ciclo. Padrao: `ciclos.jsonl` ao lado do log. */
  ciclosFile?: string;
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
  const operacionalFile =
    config.operacionalFile ?? path.join(path.dirname(logFile), "operacional.jsonl");
  const ciclosFile = config.ciclosFile ?? path.join(path.dirname(logFile), "ciclos.jsonl");
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
      void handleListLogs(req, res, logFile);
      return;
    }
    if (req.method === "DELETE" && pathname === "/api/logs") {
      void handleClearLogs(res, logFile, snapDir, eventosFile, ciclosFile);
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

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryUrl) {
  const PORT = env.PORT;
  const HOST = env.HOST;
  if (hostExpostoNaRede(HOST) && !env.NEURO_ALLOW_REMOTE) {
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
  // Registra o backend de visao configurado (URL base resolvida).
  const backendUrl = resolverBackend({}).baseUrl;
  logEvent("info", "backend_configurado", { baseUrl: backendUrl });
  console.log(`  Backend de visao: ${backendUrl}`);
  createServer().listen(PORT, HOST, () => {
    logEvent("info", "servidor_iniciado", { host: HOST, port: PORT, logFile: LOG_FILE });
    console.log(`\n  Neuro Vision rodando em http://${HOST}:${PORT}`);
    console.log(`  Logs em: ${LOG_FILE}\n`);
  });
}
