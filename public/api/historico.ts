import type { EntradaLog, EntradaLogComVideo } from "../../src/types";
import { ErroPercepcao } from "../../src/erros";
import { exigirRespostaOk } from "./http";

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

export async function listarEntradas(limite = 100): Promise<EntradaLogComVideo[]> {
  let resposta: Response;
  try {
    resposta = await fetch(`/api/logs?limit=${limite}`);
  } catch (err) {
    throw new ErroPercepcao("armazenamento", "Falha ao ler o historico", { cause: err });
  }
  if (!resposta.ok) throw new ErroPercepcao("armazenamento", `HTTP ${resposta.status}`);
  const dados = (await resposta.json()) as { entradas?: EntradaLogComVideo[] };
  return dados.entradas ?? [];
}

export async function limparHistorico(): Promise<void> {
  let resposta: Response;
  try {
    resposta = await fetch("/api/logs", { method: "DELETE" });
  } catch (err) {
    throw new ErroPercepcao("armazenamento", "Falha ao limpar o historico", { cause: err });
  }
  if (!resposta.ok) throw new ErroPercepcao("armazenamento", `HTTP ${resposta.status}`);
}