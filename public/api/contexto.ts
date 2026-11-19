import type { EntradaLog, EventoVisual } from "../../src/types";
import { ErroPercepcao } from "../../src/erros";

export interface ContextoRecente {
  resumo: string;
  roteiro: string[];
  ultimaDescricao: string;
  entradas: EntradaLog[];
  eventos: EventoVisual[];
}

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