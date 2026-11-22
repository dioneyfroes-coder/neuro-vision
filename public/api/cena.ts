import type {
  ConsolidacaoReferenciaCena,
  DecisaoRevisaoMudanca,
  ItemCena,
  MudancaCena,
  OpcoesComparacaoCena,
  ReferenciaCena,
} from "../../src/domain/cena";
import { ErroPercepcao } from "../../src/erros";
import { postMonitoramento, urlSessaoMonitoramento } from "./monitoramento";

export function urlCenaMonitoramento(sessaoId: string, acao: string): string {
  return `${urlSessaoMonitoramento(sessaoId)}/cena/${acao}`;
}

export async function definirReferenciaCena(opcoes: {
  sessaoId: string;
  itens: ItemCena[];
  criadaEmMs?: number;
  quadros?: number;
  consolidacao?: ConsolidacaoReferenciaCena;
}): Promise<ReferenciaCena> {
  const dados = await postMonitoramento<{ referencia: ReferenciaCena }>(
    urlCenaMonitoramento(opcoes.sessaoId, "referencia"),
    opcoes,
    "Falha ao salvar a referencia do ambiente"
  );
  return dados.referencia;
}

export async function obterReferenciaCena(sessaoId: string): Promise<ReferenciaCena | null> {
  let resposta: Response;
  try {
    resposta = await fetch(urlCenaMonitoramento(sessaoId, "referencia"));
  } catch (err) {
    throw new ErroPercepcao("armazenamento", "Falha ao ler a referencia do ambiente", {
      cause: err,
    });
  }
  if (!resposta.ok) throw new ErroPercepcao("armazenamento", `HTTP ${resposta.status}`);
  const dados = (await resposta.json()) as { referencia?: ReferenciaCena | null };
  return dados.referencia ?? null;
}

export async function compararCenaMonitoramento(opcoes: {
  sessaoId: string;
  itens: ItemCena[];
  agoraMs?: number;
  comparacao?: OpcoesComparacaoCena;
  confirmarRepeticao?: boolean;
  minimoConfirmacoes?: number;
}): Promise<{ mudancas: MudancaCena[]; novas: MudancaCena[]; confirmadas: MudancaCena[] }> {
  const dados = await postMonitoramento<{
    mudancas: MudancaCena[];
    novas: MudancaCena[];
    confirmadas?: MudancaCena[];
  }>(
    urlCenaMonitoramento(opcoes.sessaoId, "comparar"),
    opcoes,
    "Falha ao comparar a cena com a referencia"
  );
  return {
    mudancas: dados.mudancas ?? [],
    novas: dados.novas ?? [],
    confirmadas: dados.confirmadas ?? [],
  };
}

export async function revisarMudancaCena(opcoes: {
  sessaoId: string;
  mudancaId: string;
  decisao: DecisaoRevisaoMudanca;
  agoraMs?: number;
}): Promise<MudancaCena> {
  const dados = await postMonitoramento<{ mudanca: MudancaCena }>(
    urlCenaMonitoramento(opcoes.sessaoId, "confirmar"),
    opcoes,
    "Falha ao revisar a mudanca de cena"
  );
  return dados.mudanca;
}

export async function listarMudancasCena(
  sessaoId: string,
  limite = 2000
): Promise<MudancaCena[]> {
  let resposta: Response;
  try {
    resposta = await fetch(`${urlCenaMonitoramento(sessaoId, "mudancas")}?limit=${limite}`);
  } catch (err) {
    throw new ErroPercepcao("armazenamento", "Falha ao ler as mudancas da cena", { cause: err });
  }
  if (!resposta.ok) throw new ErroPercepcao("armazenamento", `HTTP ${resposta.status}`);
  const dados = (await resposta.json()) as { mudancas?: MudancaCena[] };
  return dados.mudancas ?? [];
}