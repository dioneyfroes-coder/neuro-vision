import {
  arredondar,
  type DeteccaoObservada,
  type MaoObservada,
  type PessoaObservada,
  type ProximidadeObjeto,
} from "./esquema";

/**
 * Priorizacao de objetos no contexto multimodal (Fase 4, item 4).
 *
 * Regra pura de **atencao**, nao de certeza: objetos perto do punho da mao ou
 * do torso da pessoa vem primeiro em `deteccoes[]`; os demais continuam no
 * payload (ou, sob teto, viram `deteccoesReduzidas`) com a mesma evidencia.
 * Proximidade nunca vira contato confirmado nem prova de acao.
 */

export interface ConfigProximidadeObjetos {
  /** Raio (coordenadas normalizadas) para `prioridade: "mao"`. */
  raioMao: number;
  /** Raio (coordenadas normalizadas) para `prioridade: "corpo"`. */
  raioCorpo: number;
  /** Casas decimais das distancias anexadas a cada deteccao. */
  decimais: number;
}

export const CONFIG_PROXIMIDADE_OBJETOS_PADRAO: ConfigProximidadeObjetos = {
  raioMao: 0.15,
  raioCorpo: 0.25,
  decimais: 2,
};

interface Ponto {
  x: number;
  y: number;
}

interface DetectadoComProximidade {
  deteccao: DeteccaoObservada;
  indice: number;
  distancia: number | undefined;
  faixa: number;
}

/**
 * Devolve uma nova lista de deteccoes ordenada por proximidade. Nao muta a
 * entrada e nao descarta nada: a poda por bytes acontece depois, em `contexto.ts`.
 */
export function priorizarDeteccoes(
  deteccoes: DeteccaoObservada[],
  maos: MaoObservada[],
  pessoas: PessoaObservada[],
  config: Partial<ConfigProximidadeObjetos> = {}
): DeteccaoObservada[] {
  const cfg = { ...CONFIG_PROXIMIDADE_OBJETOS_PADRAO, ...config };
  const pontosMao = maos
    .map((mao) => mao.landmarks.find((ponto) => ponto.nome === "punho"))
    .filter((ponto): ponto is NonNullable<typeof ponto> => Boolean(ponto));
  const pontosCorpo = pessoas
    .map((pessoa) => pontoTorso(pessoa))
    .filter((ponto): ponto is Ponto => Boolean(ponto));

  // Sem nenhum ponto de referencia, nao ha atencao a aplicar: mantem a ordem
  // original em vez de reordenar por score (evita mudar o payload antigo).
  if (pontosMao.length === 0 && pontosCorpo.length === 0) {
    return deteccoes.map((deteccao) => ({
      ...deteccao,
      proximidade: { prioridade: "contexto" as const },
    }));
  }

  const ordenadas: DetectadoComProximidade[] = deteccoes.map((deteccao, indice) => {
    const centro = centroDaCaixa(deteccao);
    const distanciaMao = menorDistancia(centro, pontosMao);
    const distanciaCorpo = menorDistancia(centro, pontosCorpo);
    const prioridade: ProximidadeObjeto["prioridade"] =
      distanciaMao !== undefined && distanciaMao <= cfg.raioMao
        ? "mao"
        : distanciaCorpo !== undefined && distanciaCorpo <= cfg.raioCorpo
          ? "corpo"
          : "contexto";
    const faixa = prioridade === "mao" ? 0 : prioridade === "corpo" ? 1 : 2;
    const distancia = Math.min(
      Number.POSITIVE_INFINITY,
      distanciaMao ?? Number.POSITIVE_INFINITY,
      distanciaCorpo ?? Number.POSITIVE_INFINITY
    );
    const proximidade: ProximidadeObjeto = {
      prioridade,
      ...(distanciaMao !== undefined
        ? { mao: arredondar(distanciaMao, cfg.decimais) }
        : {}),
      ...(distanciaCorpo !== undefined
        ? { corpo: arredondar(distanciaCorpo, cfg.decimais) }
        : {}),
    };
    return {
      deteccao: { ...deteccao, proximidade },
      indice,
      distancia: Number.isFinite(distancia) ? distancia : undefined,
      faixa,
    };
  });

  ordenadas.sort((a, b) => {
    if (a.faixa !== b.faixa) return a.faixa - b.faixa;
    if (a.distancia !== undefined && b.distancia !== undefined && a.distancia !== b.distancia) {
      return a.distancia - b.distancia;
    }
    if (a.deteccao.score !== b.deteccao.score) return b.deteccao.score - a.deteccao.score;
    return a.indice - b.indice;
  });

  return ordenadas.map((item) => item.deteccao);
}

function centroDaCaixa(deteccao: DeteccaoObservada): Ponto {
  const { xmin, ymin, xmax, ymax } = deteccao.caixa;
  return { x: (xmin + xmax) / 2, y: (ymin + ymax) / 2 };
}

function menorDistancia(origem: Ponto, pontos: Ponto[]): number | undefined {
  let menor: number | undefined;
  for (const ponto of pontos) {
    const distancia = Math.hypot(origem.x - ponto.x, origem.y - ponto.y);
    if (menor === undefined || distancia < menor) menor = distancia;
  }
  return menor;
}

/** Torso: ombros e quadris, com o mesmo espirito de `referencia-pose.ts`. */
function pontoTorso(pessoa: PessoaObservada): Ponto | undefined {
  const porNome = new Map(pessoa.keypoints.map((ponto) => [ponto.nome, ponto]));
  const nomes = [
    "ombro_esquerdo",
    "ombro_direito",
    "quadril_esquerdo",
    "quadril_direito",
  ];
  const pontos = nomes
    .map((nome) => porNome.get(nome))
    .filter((ponto): ponto is NonNullable<typeof ponto> => Boolean(ponto));
  if (pontos.length === 0) return undefined;
  return {
    x: pontos.reduce((soma, ponto) => soma + ponto.x, 0) / pontos.length,
    y: pontos.reduce((soma, ponto) => soma + ponto.y, 0) / pontos.length,
  };
}
