import type { EntradaLog, EventoVisual, MotivoAnalise, TipoEventoVisual } from "../src/types";
import { ErroPercepcao } from "../src/erros";

export interface InfoOllama {
  online: boolean;
  /** Protocolo do backend em uso (`ollama` nativo ou `openai`/LM Studio). */
  provedor?: "ollama" | "openai";
  /** Modelo de visao configurado (NEURO_MODEL/OLLAMA_MODEL ou o padrao do servidor). */
  solicitado?: string;
  /** Modelo efetivamente usado (o solicitado ou o melhor disponivel). */
  modelo: string;
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
  /** Instante ISO da captura do frame (antes da inferencia). */
  capturadoEm?: string;
  modelo?: string;
  anterior?: string;
  modo?: "roteiro" | "descricao";
  roteiro?: string;
  base?: boolean;
  /** Razao que acionou esta analise (fluxo orientado a eventos). */
  motivo?: MotivoAnalise;
}

export interface ResultadoVisao {
  evento: EventoVisao | null;
  parcial: string;
}

/** Erro reportado pelo proprio stream do backend de visao (nao deve ser reembrulhado). */
class ErroEventoVisao extends ErroPercepcao {
  constructor(mensagem: string) {
    super("ollama", mensagem);
    this.name = "ErroEventoVisao";
  }
}

async function exigirRespostaOk(resposta: Response, msgPadrao: string): Promise<void> {
  if (!resposta.ok) {
    const corpo = (await resposta.json().catch(() => null)) as { erro?: string } | null;
    throw new ErroPercepcao("armazenamento", corpo?.erro ?? `${msgPadrao} (${resposta.status})`);
  }
}

/** `POST /api/log` — grava uma entrada no historico do servidor. */
export async function gravarEntrada(entrada: EntradaLog): Promise<void> {
  let resposta: Response;
  try {
    resposta = await fetch("/api/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entrada),
    });
  } catch (err) {
    throw new ErroPercepcao("armazenamento", "Falha ao gravar no log do servidor", { cause: err });
  }
  await exigirRespostaOk(resposta, "Falha ao gravar no log do servidor");
}

/** `GET /api/logs` — lista as entradas mais recentes (mais nova primeiro). */
export async function listarEntradas(limite = 100): Promise<EntradaLog[]> {
  let resposta: Response;
  try {
    resposta = await fetch(`/api/logs?limit=${limite}`);
  } catch (err) {
    throw new ErroPercepcao("armazenamento", "Falha ao ler o historico", { cause: err });
  }
  if (!resposta.ok) throw new ErroPercepcao("armazenamento", `HTTP ${resposta.status}`);
  const dados = (await resposta.json()) as { entradas?: EntradaLog[] };
  return dados.entradas ?? [];
}

/** `DELETE /api/logs` — limpa o historico. */
export async function limparHistorico(): Promise<void> {
  let resposta: Response;
  try {
    resposta = await fetch("/api/logs", { method: "DELETE" });
  } catch (err) {
    throw new ErroPercepcao("armazenamento", "Falha ao limpar o historico", { cause: err });
  }
  if (!resposta.ok) throw new ErroPercepcao("armazenamento", `HTTP ${resposta.status}`);
}

/** `POST /api/eventos` — grava um evento estruturado (distinto do historico). */
export async function gravarEvento(evento: EventoVisual): Promise<void> {
  let resposta: Response;
  try {
    resposta = await fetch("/api/eventos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(evento),
    });
  } catch (err) {
    throw new ErroPercepcao("armazenamento", "Falha ao gravar evento no servidor", { cause: err });
  }
  await exigirRespostaOk(resposta, "Falha ao gravar evento no servidor");
}

/** Filtros de consulta ao historico de eventos (`GET /api/eventos`). */
export interface FiltrosEventos {
  /** Tipos aceitos; vazio/omisso = todos. */
  tipos?: TipoEventoVisual[];
  /** Somente eventos deste objeto rastreado. */
  objetoId?: string;
  /** Inicio da janela (epoch ms, inclusive). */
  desde?: number;
  /** Fim da janela (epoch ms, inclusive). */
  ate?: number;
}

/** `GET /api/eventos` — lista os eventos mais recentes (mais novo primeiro). */
export async function listarEventos(
  limite = 100,
  filtros: FiltrosEventos = {}
): Promise<EventoVisual[]> {
  const params = new URLSearchParams({ limit: String(limite) });
  if (filtros.tipos?.length) params.set("tipo", filtros.tipos.join(","));
  if (filtros.objetoId) params.set("objetoId", filtros.objetoId);
  if (filtros.desde !== undefined) params.set("desde", String(filtros.desde));
  if (filtros.ate !== undefined) params.set("ate", String(filtros.ate));

  let resposta: Response;
  try {
    resposta = await fetch(`/api/eventos?${params.toString()}`);
  } catch (err) {
    throw new ErroPercepcao("armazenamento", "Falha ao ler os eventos", { cause: err });
  }
  if (!resposta.ok) throw new ErroPercepcao("armazenamento", `HTTP ${resposta.status}`);
  const dados = (await resposta.json()) as { eventos?: EventoVisual[] };
  return dados.eventos ?? [];
}

/** `POST /api/operacional` — registra falha/metrica operacional (nao e evento visual). */
export async function gravarOperacional(registro: {
  nivel?: "info" | "aviso" | "erro";
  origem?: string;
  mensagem: string;
  detalhe?: string;
}): Promise<void> {
  try {
    await fetch("/api/operacional", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(registro),
    });
  } catch {
    // Registro operacional e best-effort: nao interrompe a captura.
  }
}

/** Contexto recente reconstruido pelo servidor a partir da memoria persistida. */
export interface ContextoRecente {
  resumo: string;
  roteiro: string[];
  ultimaDescricao: string;
  entradas: EntradaLog[];
  eventos: EventoVisual[];
}

/** `GET /api/contexto` — reconstroi o contexto recente (janela limitada). */
export async function obterContexto(): Promise<ContextoRecente | null> {
  let resposta: Response;
  try {
    resposta = await fetch("/api/contexto");
  } catch (err) {
    throw new ErroPercepcao("armazenamento", "Falha ao recuperar o contexto", { cause: err });
  }
  if (!resposta.ok) throw new ErroPercepcao("armazenamento", `HTTP ${resposta.status}`);
  const dados = (await resposta.json()) as Partial<ContextoRecente>;
  return {
    resumo: dados.resumo ?? "",
    roteiro: dados.roteiro ?? [],
    ultimaDescricao: dados.ultimaDescricao ?? "",
    entradas: dados.entradas ?? [],
    eventos: dados.eventos ?? [],
  };
}

/** `GET /api/health` — status do backend de visao. */
export async function saudeOllama(): Promise<InfoOllama | null> {
  let resposta: Response;
  try {
    resposta = await fetch("/api/health");
  } catch (err) {
    throw new ErroPercepcao("ollama", "Backend de visao: servidor indisponivel", { cause: err });
  }
  const dados = (await resposta.json()) as { ollama?: InfoOllama };
  return dados.ollama ?? null;
}

/** `GET /api/visao/preparar` — garante o modelo de visao em memoria. */
export async function prepararOllama(): Promise<PreparacaoOllama> {
  let resposta: Response;
  try {
    resposta = await fetch("/api/visao/preparar");
  } catch (err) {
    throw new ErroPercepcao("ollama", "Falha ao contactar o servidor (/api/visao/preparar)", {
      cause: err,
    });
  }
  if (!resposta.ok) {
    const corpo = (await resposta.json().catch(() => null)) as { erro?: string } | null;
    throw new ErroPercepcao("ollama", corpo?.erro ?? `Falha ao preparar o backend de visao (${resposta.status})`);
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
    throw new ErroPercepcao("ollama", "Falha ao contactar o servidor (/api/visao)", { cause: err });
  }

  if (!resposta.ok || !resposta.body) {
    const corpo = (await resposta.json().catch(() => null)) as { erro?: string } | null;
    throw new ErroPercepcao("ollama", corpo?.erro ?? `Backend de visao respondeu ${resposta.status}`);
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
          throw new ErroEventoVisao(evt.erro ?? "Erro no backend de visao");
        }
      }
    }
  } catch (err) {
    if (err instanceof ErroEventoVisao) throw err;
    if ((err as Error).name === "AbortError") throw err;
    throw new ErroPercepcao("ollama", `Erro ao ler resposta do backend de visao: ${(err as Error).message}`, {
      cause: err,
    });
  }

  return { evento, parcial };
}
