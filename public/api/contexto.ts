import type { EntradaLog, EventoVisual } from "../../src/types";
import { ErroPercepcao } from "../../src/erros";

export interface ContextoRecente {
  /** Sessão pedida; ausente quando o contexto é global. */
  sessionId?: string;
  resumo: string;
  roteiro: string[];
  ultimaDescricao: string;
  entradas: EntradaLog[];
  eventos: EventoVisual[];
}

export async function obterContexto(sessionId?: string): Promise<ContextoRecente | null> {
  let resposta: Response;
  try {
    const params = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
    resposta = await fetch(`/api/contexto${params}`);
  } catch (err) {
    throw new ErroPercepcao("armazenamento", "Falha ao recuperar o contexto", { cause: err });
  }
  if (!resposta.ok) throw new ErroPercepcao("armazenamento", `HTTP ${resposta.status}`);
  const dados = (await resposta.json()) as Partial<ContextoRecente>;
  return {
    sessionId: dados.sessionId,
    resumo: dados.resumo ?? "",
    roteiro: dados.roteiro ?? [],
    ultimaDescricao: dados.ultimaDescricao ?? "",
    entradas: dados.entradas ?? [],
    eventos: dados.eventos ?? [],
  };
}