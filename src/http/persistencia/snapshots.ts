import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  EVENTOS_FILE,
  LOG_FILE,
  POLITICA_SNAPSHOTS_PADRAO,
  SNAP_CACHE_TTL_MS,
  SNAP_CLEAN_INTERVAL_MS,
  SNAP_DIR,
  SNAP_URL,
  SnapshotCacheEntry,
  arquivosDeMemoria,
  logEvent,
  nomeArquivoSnapshot,
  registrarFalha,
} from "../base";
import type {
  ArquivoSnapshot,
  OpcoesLimpezaSnapshots,
  ResultadoLimpezaSnapshots,
} from "./tipos";

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
