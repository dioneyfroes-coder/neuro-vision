import { cabecalhos, montarRequisicaoChat, urlEmMemoria } from "../provedor";
import {
  ErroVisao,
  backendDe,
  mesmoModelo,
  normalizarNomeModelo,
  resolverModelo,
  type OpcoesVisao,
} from "./comum";

export async function modelosEmMemoria(opcoes: OpcoesVisao = {}): Promise<string[]> {
  const backend = backendDe(opcoes);
  const url = urlEmMemoria(backend);
  try {
    const resposta = await fetch(url, {
      headers: cabecalhos(backend),
      signal: AbortSignal.timeout(opcoes.timeoutMs ?? 5_000),
    });
    if (!resposta.ok) return [];
    const dados = (await resposta.json()) as {
      data?: { id?: string; state?: string }[];
      models?: { id?: string; state?: string }[];
    };
    // LM Studio (REST v0): so considera "em memoria" os `state: loaded`.
    return (dados.data ?? dados.models ?? [])
      .filter((m) => m.state === undefined || m.state === "loaded")
      .map((m) => m.id ?? "")
      .filter((n) => n.length > 0);
  } catch {
    return [];
  }
}

export async function modeloEmMemoria(opcoes: OpcoesVisao = {}): Promise<boolean> {
  const modelo = resolverModelo(opcoes);
  if (!normalizarNomeModelo(modelo)) return false;
  const memoria = await modelosEmMemoria(opcoes);
  return memoria.some((m) => mesmoModelo(m, modelo));
}

/**
 * Indica se o backend permite consultar o que esta em memoria. Tentamos o REST
 * v0 do LM Studio (`/api/v0/models`), que pode nao existir em outras
 * implementacoes. Quando nao ha como confirmar, tratamos a carga bem-sucedida
 * como suficiente.
 */
export async function memoriaIntrospectavel(opcoes: OpcoesVisao = {}): Promise<boolean> {
  const backend = backendDe(opcoes);
  const url = urlEmMemoria(backend);
  try {
    const resposta = await fetch(url, {
      headers: cabecalhos(backend),
      signal: AbortSignal.timeout(opcoes.timeoutMs ?? 5_000),
    });
    return resposta.ok;
  } catch {
    return false;
  }
}

export async function forcarCarregamento(opcoes: OpcoesVisao = {}): Promise<number> {
  const backend = backendDe(opcoes);
  const modelo = resolverModelo(opcoes);
  const timeoutMs = opcoes.timeoutMs ?? 180_000;
  if (await modeloEmMemoria(opcoes)) return 0;

  const inicio = performance.now();
  const requisicao = montarRequisicaoChat({
    backend,
    modelo,
    prompt: "oi",
    stream: false,
    amostragem: { temperature: 0 },
  });
  const resposta = await fetch(requisicao.url, {
    method: "POST",
    headers: requisicao.headers,
    body: requisicao.body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!resposta.ok) {
    const texto = await resposta.text().catch(() => "");
    throw new ErroVisao(`resposta HTTP ${resposta.status}: ${texto.slice(0, 300)}`);
  }
  await resposta.json().catch(() => null);

  // So espera confirmacao em memoria se o backend permite consulta-la; caso
  // contrario (ex.: LM Studio sem `/api/v0/models`), a resposta acima ja
  // prova que o modelo esta carregado.
  if (await memoriaIntrospectavel(opcoes)) {
    for (let i = 0; i < 60; i++) {
      if (await modeloEmMemoria(opcoes)) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  return Math.round(performance.now() - inicio);
}
