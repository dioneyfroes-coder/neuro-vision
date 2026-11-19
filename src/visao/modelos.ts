import { cabecalhos, urlModelos } from "../provedor";
import {
  PREFERENCIA_MODELOS,
  backendDe,
  mesmoModelo,
  normalizarNomeModelo,
  resolverModelo,
  type OpcoesVisao,
} from "./comum";

/**
 * Escolhe o "melhor" modelo entre os instalados segundo `PREFERENCIA_MODELOS`.
 * Se nenhum prefixo conhecido casar, devolve o primeiro da lista (melhor
 * esforco) e, se a lista estiver vazia, devolve string vazia.
 */
export function melhorModeloDisponivel(instalados: string[]): string {
  if (instalados.length === 0) return "";
  for (const prefixo of PREFERENCIA_MODELOS) {
    const achado = instalados.find((nome) =>
      normalizarNomeModelo(nome).toLowerCase().startsWith(prefixo)
    );
    if (achado) return achado;
  }
  return instalados[0];
}

/** Lista os modelos instalados/baixados no backend. */
export async function modelosInstalados(opcoes: OpcoesVisao = {}): Promise<string[]> {
  const backend = backendDe(opcoes);
  try {
    const resposta = await fetch(urlModelos(backend), {
      headers: cabecalhos(backend),
      signal: AbortSignal.timeout(opcoes.timeoutMs ?? 5_000),
    });
    if (!resposta.ok) return [];
    const dados = (await resposta.json()) as {
      data?: { id?: string }[];
      models?: { id?: string }[];
    };
    const nomes = (dados.data ?? dados.models ?? []).map((m) => m.id ?? "");
    return nomes.filter((n) => n.length > 0);
  } catch {
    return [];
  }
}

export interface ModeloEscolhido {
  /** Modelo configurado (`NEURO_MODEL` ou `MODELO_PADRAO`). */
  solicitado: string;
  /** Modelo efetivamente usado (pode ser o melhor disponivel). */
  modelo: string;
  /** `true` quando o solicitado nao estava instalado e houve substituicao. */
  alternativo: boolean;
}

const CACHE_MODELO_MS = 30_000;
let cacheModelo: { chave: string; valor: ModeloEscolhido; expira: number } | null = null;

/** Descarta a cache de escolha de modelo (usado em testes). */
export function limparCacheModelo(): void {
  cacheModelo = null;
}

/**
 * Resolve o modelo efetivo: usa o configurado quando instalado; se nao estiver
 * (e o backend responder com a lista), escolhe o melhor disponivel. Um modelo
 * passado explicitamente em `opcoes.modelo` e sempre respeitado, sem fallback.
 */
export async function escolherModelo(opcoes: OpcoesVisao = {}): Promise<ModeloEscolhido> {
  const solicitado = resolverModelo(opcoes);
  if (opcoes.modelo) return { solicitado, modelo: solicitado, alternativo: false };

  const backend = backendDe(opcoes);
  const chave = `${backend.baseUrl}|${solicitado}`;
  const agora = Date.now();
  if (cacheModelo && cacheModelo.chave === chave && cacheModelo.expira > agora) {
    return cacheModelo.valor;
  }

  const instalados = await modelosInstalados(opcoes);
  let valor: ModeloEscolhido = { solicitado, modelo: solicitado, alternativo: false };
  if (instalados.length > 0 && !instalados.some((m) => mesmoModelo(m, solicitado))) {
    const melhor = melhorModeloDisponivel(instalados);
    if (melhor) valor = { solicitado, modelo: melhor, alternativo: true };
  }
  cacheModelo = { chave, valor, expira: agora + CACHE_MODELO_MS };
  return valor;
}
