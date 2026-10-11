import type { EntradaLog } from "../src/types";

export interface InfoOllama {
  online: boolean;
  modelos: string[];
  carregados: string[];
  erro: string;
}

export interface PreparacaoOllama {
  modelo?: string;
  carregado?: boolean;
  carregandoMs?: number;
}

export interface EventoVisao {
  type?: string;
  response?: string;
  descricao?: string;
  modelo?: string;
  snapshot?: string;
  erro?: string;
  tokens?: number;
  ms?: number;
  tipo?: string;
  papel?: "base" | "delta";
  semMudanca?: boolean;
}

export interface PayloadVisao {
  imagem: string;
  snapshot?: string;
  modelo?: string;
  anterior?: string;
  modo?: "roteiro" | "descricao";
  roteiro?: string;
  base?: boolean;
}

export interface ResultadoVisao {
  evento: EventoVisao | null;
  parcial: string;
}

/** Erro reportado pelo proprio stream do Ollama (nao deve ser reembrulhado). */
class ErroEventoVisao extends Error {}

/** `POST /api/log` — grava uma entrada no historico do servidor. */
export async function gravarEntrada(entrada: EntradaLog): Promise<void> {
  await fetch("/api/log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entrada),
  });
}

/** `GET /api/logs` — lista as entradas mais recentes (mais nova primeiro). */
export async function listarEntradas(limite = 100): Promise<EntradaLog[]> {
  const resposta = await fetch(`/api/logs?limit=${limite}`);
  if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
  const dados = (await resposta.json()) as { entradas?: EntradaLog[] };
  return dados.entradas ?? [];
}

/** `DELETE /api/logs` — limpa o historico. */
export async function limparHistorico(): Promise<void> {
  const resposta = await fetch("/api/logs", { method: "DELETE" });
  if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
}

/** `GET /api/health` — status do Ollama. */
export async function saudeOllama(): Promise<InfoOllama | null> {
  const resposta = await fetch("/api/health");
  const dados = (await resposta.json()) as { ollama?: InfoOllama };
  return dados.ollama ?? null;
}

/** `GET /api/visao/preparar` — garante o modelo do Ollama em memoria. */
export async function prepararOllama(): Promise<PreparacaoOllama> {
  const resposta = await fetch("/api/visao/preparar");
  if (!resposta.ok) {
    const corpo = (await resposta.json().catch(() => null)) as { erro?: string } | null;
    throw new Error(corpo?.erro ?? `Falha ao preparar Ollama (${resposta.status})`);
  }
  return (await resposta.json()) as PreparacaoOllama;
}

/**
 * `POST /api/visao` — envia o frame e consome o stream NDJSON.
 * `onChunk` recebe o texto parcial acumulado a cada pedaco recebido.
 * Retorna o evento `done` (ou null) e o texto parcial completo.
 */
export async function descreverFrame(
  payload: PayloadVisao,
  signal: AbortSignal,
  onChunk?: (parcial: string) => void
): Promise<ResultadoVisao> {
  let resposta: Response;
  try {
    resposta = await fetch("/api/visao", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new Error("Falha ao contactar o servidor (/api/visao)", { cause: err });
  }

  if (!resposta.ok || !resposta.body) {
    const corpo = (await resposta.json().catch(() => null)) as { erro?: string } | null;
    throw new Error(corpo?.erro ?? `Ollama respondeu ${resposta.status}`);
  }

  const reader = resposta.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let parcial = "";
  let evento: EventoVisao | null = null;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const linha = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!linha) continue;
        const evt = JSON.parse(linha) as EventoVisao;
        if (evt.type === "chunk" && evt.response) {
          parcial += evt.response;
          onChunk?.(parcial);
        } else if (evt.type === "done") {
          evento = evt;
        } else if (evt.type === "erro") {
          throw new ErroEventoVisao(evt.erro ?? "Erro no Ollama");
        }
      }
    }
  } catch (err) {
    if (err instanceof ErroEventoVisao) throw err;
    if ((err as Error).name === "AbortError") throw err;
    throw new Error(`Erro ao ler resposta do Ollama: ${(err as Error).message}`, { cause: err });
  }

  return { evento, parcial };
}
