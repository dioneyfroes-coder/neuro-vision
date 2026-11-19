/**
 * Repositorios JSONL e persistencia/limpeza de snapshots.
 *
 * Extraido de `src/server.ts` na refatoracao de responsabilidades.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { RegistroOperacional } from "../memoria";
import { RegistroCiclo } from "../domain/cycle";
import { gravarObservacao } from "../persistence/repositorio-observacoes";
import { lerObservacoes } from "../persistence/repositorio-observacoes";
import { limparObservacoes } from "../persistence/repositorio-observacoes";
import { gravarEvento } from "../persistence/repositorio-eventos";
import { lerEventos as lerEventosRepo } from "../persistence/repositorio-eventos";
import { limparEventos as limparEventosRepo } from "../persistence/repositorio-eventos";
import { gravarEventoTemporal } from "../persistence/repositorio-eventos-temporais";
import { lerEventosTemporais as lerEventosTemporaisRepo } from "../persistence/repositorio-eventos-temporais";
import { limparEventosTemporais as limparEventosTemporaisRepo } from "../persistence/repositorio-eventos-temporais";
import { gravarOperacional } from "../persistence/repositorio-operacional";
import { lerOperacional as lerOperacionalRepo } from "../persistence/repositorio-operacional";
import { gravarCiclo } from "../persistence/repositorio-ciclos";
import { lerCiclos as lerCiclosRepo } from "../persistence/repositorio-ciclos";
import { limparCiclos } from "../persistence/repositorio-ciclos";
import { EntradaLog } from "../types";
import { EventoTemporalPersistido } from "../types";
import { EventoVisual } from "../types";
import { EstadoEventoTemporal } from "../domain/temporal-event";
import { MotivoEncerramentoEvento } from "../domain/temporal-event";
import { OrigemSinalTemporal } from "../domain/temporal-event";
import { TipoEventoTemporal } from "../domain/temporal-event";

import { CICLOS_FILE, EVENTOS_FILE, EVENTOS_TEMPORAIS_FILE, LOG_FILE, LOG_MAX_BYTES, OPERACIONAL_FILE, POLITICA_SNAPSHOTS_PADRAO, PoliticaSnapshots, SNAP_CACHE_TTL_MS, SNAP_CLEAN_INTERVAL_MS, SNAP_DIR, SNAP_URL, SnapshotCacheEntry, arquivosDeMemoria, limiteUploadSnapshot, logEvent, nomeArquivoSnapshot, registrarFalha } from "./base";
import { normalizarMotivo } from "./validacao";

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

/** Grava uma atualizacao de evento temporal de gesto/postura (P2.6). */
export async function appendEventoTemporal(
  evento: EventoTemporalPersistido,
  filePath: string = EVENTOS_TEMPORAIS_FILE
): Promise<void> {
  await gravarEventoTemporal(evento, filePath, LOG_MAX_BYTES);
}

/** Le as atualizacoes de eventos temporais mais recentes (mais recente primeiro). */
export async function lerEventosTemporais(
  filePath: string = EVENTOS_TEMPORAIS_FILE,
  limit = 100
): Promise<EventoTemporalPersistido[]> {
  return lerEventosTemporaisRepo(filePath, limit);
}

/** Esvazia a memoria de gestos/posturas. */
export async function limparEventosTemporais(
  filePath: string = EVENTOS_TEMPORAIS_FILE
): Promise<void> {
  await limparEventosTemporaisRepo(filePath);
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

export type SubsistemaIndisponivel = RegistroCiclo["subsistemasIndisponiveis"][number];

export const SUBSISTEMAS_VALIDOS: SubsistemaIndisponivel[] = ["deteccao", "pose", "maos", "nsfw"];

/**
 * Tipos que entram na memoria pesquisavel de gestos/posturas (P2.6). Ficam
 * fora de `eventos.jsonl` de proposito: o stream legado continua restrito a
 * fatos visuais (`aparicao`/`desaparecimento`/`mudanca_de_cena`).
 */
export const TIPOS_EVENTO_TEMPORAL_PERSISTIDOS: TipoEventoTemporal[] = [
  "gesto_detectado",
  "braco_levantado",
  "transicao_acao",
  "movimento_corporal",
  "pose_compativel_sexual",
  "interacao_objeto",
];

export const MOTIVOS_ENCERRAMENTO_TEMPORAL: MotivoEncerramentoEvento[] = [
  "sem_sinal",
  "troca_sinal",
  "periodo_cego",
  "oclusao",
  "transicao_concluida",
  "ponto",
];

export const ESTADOS_EVENTO_TEMPORAL_PERSISTIDOS: EstadoEventoTemporal[] = [
  "provavel",
  "confirmado",
  "encerrado",
  "incerto",
];

export const ORIGENS_SINAL_TEMPORAL: OrigemSinalTemporal[] = [
  "objetos",
  "pose",
  "maos",
  "cena",
  "movimento",
];

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
  const politica =
    typeof p.politica === "object" && p.politica !== null
      ? (p.politica as RegistroCiclo["politica"])
      : undefined;
  const configuracao =
    typeof p.configuracao === "object" && p.configuracao !== null
      ? (p.configuracao as RegistroCiclo["configuracao"])
      : undefined;
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
    politica,
    configuracao,
    cancelado: p.cancelado === true,
    registroEm: typeof p.registroEm === "string" ? p.registroEm : new Date().toISOString(),
  };
}

/**
 * Normaliza o corpo de `POST /api/eventos-temporais` em um registro
 * persistivel. So aceita os tipos de gesto/postura/movimento corporal e os
 * estados finais/incertos; `candidato` nunca vira memoria.
 */
export function montarEventoTemporal(payload: unknown): EventoTemporalPersistido | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.eventoId !== "string" || !p.eventoId) return null;
  if (typeof p.sessionId !== "string" || !p.sessionId) return null;
  if (!TIPOS_EVENTO_TEMPORAL_PERSISTIDOS.includes(p.tipo as TipoEventoTemporal)) return null;
  if (typeof p.inicioEm !== "string" || !p.inicioEm) return null;
  if (typeof p.descricao !== "string" || !p.descricao) return null;
  if (!ESTADOS_EVENTO_TEMPORAL_PERSISTIDOS.includes(p.estado as EstadoEventoTemporal)) {
    return null;
  }
  if (typeof p.idempotencyKey !== "string" || !p.idempotencyKey) return null;

  const frameIds = Array.isArray(p.frameIds)
    ? p.frameIds.filter((id): id is string => typeof id === "string")
    : [];
  const origens = Array.isArray(p.origens)
    ? p.origens.filter((origem): origem is OrigemSinalTemporal =>
        ORIGENS_SINAL_TEMPORAL.includes(origem as OrigemSinalTemporal)
      )
    : [];
  const confianca =
    typeof p.confianca === "number" && Number.isFinite(p.confianca) ? p.confianca : undefined;
  const intervalo =
    typeof p.intervaloSemObservacaoMs === "number" &&
    Number.isFinite(p.intervaloSemObservacaoMs)
      ? p.intervaloSemObservacaoMs
      : undefined;
  const motivoEncerramento = MOTIVOS_ENCERRAMENTO_TEMPORAL.includes(
    p.motivoEncerramento as MotivoEncerramentoEvento
  )
    ? (p.motivoEncerramento as MotivoEncerramentoEvento)
    : undefined;
  const continuidadeValida =
    typeof p.continuidadeValida === "boolean" ? p.continuidadeValida : undefined;
  const evidencias = Array.isArray(p.evidencias)
    ? p.evidencias.filter((e): e is string => typeof e === "string")
    : undefined;
  const participantes = Array.isArray(p.participantes)
    ? p.participantes.filter((id): id is string => typeof id === "string" && id.length > 0)
    : undefined;

  return {
    eventoId: p.eventoId,
    sessionId: p.sessionId,
    cycleId: typeof p.cycleId === "string" ? p.cycleId : undefined,
    tipo: p.tipo as TipoEventoTemporal,
    inicioEm: p.inicioEm,
    fimEm: typeof p.fimEm === "string" ? p.fimEm : undefined,
    ultimaEvidenciaEm:
      typeof p.ultimaEvidenciaEm === "string" ? p.ultimaEvidenciaEm : undefined,
    ultimaObservacaoEm:
      typeof p.ultimaObservacaoEm === "string" ? p.ultimaObservacaoEm : undefined,
    entidadeId: typeof p.entidadeId === "string" ? p.entidadeId : undefined,
    participantes,
    rotuloObjeto: typeof p.rotuloObjeto === "string" ? p.rotuloObjeto : undefined,
    descricao: p.descricao,
    confianca,
    origens,
    frameIds,
    estado: p.estado as EstadoEventoTemporal,
    intervaloSemObservacaoMs: intervalo,
    motivoEncerramento,
    continuidadeValida,
    evidencias,
    idempotencyKey: p.idempotencyKey,
    registradoEm:
      typeof p.registradoEm === "string" ? p.registradoEm : new Date().toISOString(),
  };
}

export function extrairBase64Imagem(imagem: unknown): string | null {
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

export function campoTipoTexto(valor: unknown, campo: string): string | null {
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
  const erroFrameIds = validarListaFrameIds(p.frameIds);
  if (erroFrameIds) return erroFrameIds;
  return validarSnapshot(p.snapshot);
}

/** Valida uma lista de imagens (data URL/base64) para `POST /api/visao`. */
export function validarListaImagens(valor: unknown): string | null {
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

/** Valida os IDs de frames associados à inferência multimodal. */
export function validarListaFrameIds(valor: unknown): string | null {
  if (valor === undefined || valor === null) return null;
  if (!Array.isArray(valor)) return "campo 'frameIds' deve ser uma lista";
  if (valor.some((id) => typeof id !== "string" || id.length === 0)) {
    return "cada item de 'frameIds' deve ser texto não vazio";
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
    campoTipoTexto(p.capturadoEm, "capturadoEm") ??
    campoTipoTexto(p.contexto, "contexto");
  if (texto) return texto;
  const erroImagens = validarListaImagens(p.imagens);
  if (erroImagens) return erroImagens;
  const erroFrameIds = validarListaFrameIds(p.frameIds);
  if (erroFrameIds) return erroFrameIds;
  if (p.nsfw !== undefined && !Array.isArray(p.nsfw)) {
    return "campo 'nsfw' deve ser uma lista";
  }
  if (p.nsfwAtivo !== undefined && typeof p.nsfwAtivo !== "boolean") {
    return "campo 'nsfwAtivo' deve ser booleano";
  }
  if (p.motivo !== undefined && p.motivo !== null && !normalizarMotivo(p.motivo)) {
    return "campo 'motivo' tem valor invalido";
  }
  return validarSnapshot(p.snapshot);
}

/** Extrai a lista de imagens do payload (`imagens[]` ou `imagem` singular). */
export function extrairImagens(p: Record<string, unknown>): string[] {
  if (Array.isArray(p.imagens)) {
    return p.imagens.filter((v): v is string => typeof v === "string" && v.length > 0);
  }
  return typeof p.imagem === "string" && p.imagem.length > 0 ? [p.imagem] : [];
}

export interface ArquivoSnapshot {
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

export const snapshotCache = new Map<string, SnapshotCacheEntry>();

export function limparCacheSnapshots(agora = Date.now()): void {
  for (const [chave, entrada] of snapshotCache) {
    if (agora - entrada.ts > SNAP_CACHE_TTL_MS) snapshotCache.delete(chave);
  }
}

/** Coleta os nomes de snapshot referenciados pela parte preservada do historico. */
export async function coletarSnapshotsReferenciados(logFiles: string[]): Promise<Set<string>> {
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

export async function listarSnapshots(snapDir: string): Promise<ArquivoSnapshot[]> {
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

export let ultimaLimpezaSnapshotsMs = 0;

/**
 * Dispara a limpeza de forma oportunista (apos gravar snapshots), no maximo uma
 * vez por `SNAP_CLEAN_INTERVAL_MS`, sem manter o processo vivo nem bloquear a
 * resposta da requisicao.
 */
export function agendarLimpezaSnapshots(
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
        registrarFalha("warn", "snapshots_limpeza_parcial", { erros: resultado.erros });
      }
    })
    .catch((err) => {
      registrarFalha("warn", "limpeza_snapshots_falhou", { erro: (err as Error).message });
    });
}
