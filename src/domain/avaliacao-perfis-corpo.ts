/**
 * Avaliação dos perfis de descrição corporal (Fase 2 do plano NSFW).
 *
 * Duas coisas diferentes ficam aqui, sempre separadas:
 *
 * 1. `compararPromptsCorpo()` — compara **deterministicamente** os três textos
 *    gerados a partir das mesmas marcações. Não envolve modelo e prova apenas
 *    que os perfis são distintos e que o neutro não herda a instrução NSFW.
 * 2. `compararPerfisCorpo()` — compara respostas já coletadas com anotação
 *    **humana revisada**. Sem anotação revisada ou sem respostas, o relatório
 *    volta `sem_dados` com motivo: omissões/sexualização indevida nunca são
 *    inferidas de contagem de detecções nem de prompt.
 *
 * Mesmo quando há anotação, os números são léxicos (sinônimos declarados),
 * nunca precisão/recall universal.
 */

import type { PerfilDescricaoCorporal } from "../nsfw-prompt";
import { blocoPerfilCorporal } from "../nsfw-prompt";
import type { QuadroNsfwPrompt } from "../nsfw-prompt";

/** Taxonomia interna do plano (§3.2), independente dos rótulos brutos dos modelos. */
export const ROTULOS_CORPO = [
  "torso_exposto",
  "peitoral_exposto",
  "abdomen_exposto",
  "roupa_sem_manga",
  "roupa_aberta",
  "nudez_parcial",
  "anatomia_intima_visivel",
  "conteudo_sexual_explicito",
] as const;

export type RotuloCorpo = (typeof ROTULOS_CORPO)[number];

/** Sinônimos léxicos usados somente para contar omissões; não são inferência semântica. */
const SINONIMOS: Readonly<Record<RotuloCorpo, readonly string[]>> = {
  torso_exposto: ["torso exposto", "torso sem camisa", "sem camisa", "torso descoberto"],
  peitoral_exposto: ["peitoral", "torax exposto", "torax descoberto"],
  abdomen_exposto: ["abdomen", "barriga", "ventre"],
  roupa_sem_manga: ["sem manga", "regata", "camiseta sem manga"],
  roupa_aberta: ["roupa aberta", "camisa aberta", "blusa aberta"],
  nudez_parcial: ["nudez parcial", "parcialmente nu", "corpo exposto"],
  anatomia_intima_visivel: ["genital", "penis", "vagina", "anus", "nadeira", "nadega"],
  conteudo_sexual_explicito: ["sexo explicito", "pornografia", "ato sexual", "relacao sexual"],
};

/** Termos que indicam sexualização indevida quando a cena não é sexual. */
const TERMOS_SEXUALIZANTES = [
  "porn",
  "pornograf",
  "erotic",
  "erotico",
  "erotica",
  "excitad",
  "estimulad",
  "masturbac",
  "penetrac",
  "orgasmo",
  "sexo oral",
];

/** Normalização acento-insensível para comparação léxica determinística. */
export function normalizarTextoCorpo(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ");
}

export interface AnotacaoCorpo {
  /** Id estável que liga anotação e resposta (frameId, nome de arquivo, etc.). */
  id: string;
  /** Rótulos esperados da taxonomia interna. */
  rotulos: readonly string[];
  /** `true` somente se a revisão humana marcou conteúdo sexual explicitamente visível. */
  conteudoSexualExplicito: boolean;
  /** Só anotações `revisada` produzem números. */
  revisao?: { status?: string };
}

export interface RespostaCorpo {
  id: string;
  perfil: PerfilDescricaoCorporal;
  descricao: string;
}

export interface MetricasPerfilCorpo {
  respostas: number;
  semResposta: number;
  totalEsperado: number;
  omissoes: number;
  rotulosSemRegra: number;
  totalNaoSexual: number;
  sexualizacoesIndevidas: number;
}

export interface ComparacaoPerfisCorpo {
  status: "avaliado" | "sem_dados";
  motivo?: string;
  /** Sempre léxico; sinaliza que os números não são precisão/recall. */
  base: "comparacao-lexica";
  porPerfil: Record<PerfilDescricaoCorporal, MetricasPerfilCorpo>;
  respostasSemAnotacao: number;
}

function metricasVazias(): MetricasPerfilCorpo {
  return {
    respostas: 0,
    semResposta: 0,
    totalEsperado: 0,
    omissoes: 0,
    rotulosSemRegra: 0,
    totalNaoSexual: 0,
    sexualizacoesIndevidas: 0,
  };
}

function semDados(motivo: string): ComparacaoPerfisCorpo {
  return {
    status: "sem_dados",
    motivo,
    base: "comparacao-lexica",
    porPerfil: { sfw: metricasVazias(), neutro: metricasVazias(), nsfw: metricasVazias() },
    respostasSemAnotacao: 0,
  };
}

export function compararPerfisCorpo(
  anotacoes: readonly AnotacaoCorpo[],
  respostas: readonly RespostaCorpo[]
): ComparacaoPerfisCorpo {
  if (anotacoes.length === 0) {
    return semDados("sem anotacao humana revisada: nao ha como medir omissao ou sexualizacao");
  }
  if (respostas.length === 0) {
    return semDados("sem respostas coletadas: anotacao existe, mas nenhum perfil foi executado");
  }
  const naoRevisadas = anotacoes.filter((a) => a.revisao?.status !== "revisada");
  if (naoRevisadas.length > 0) {
    return semDados(
      `${naoRevisadas.length} anotacao(oes) sem revisao status=revisada; numeros nao sao divulgados`
    );
  }

  const porId = new Map(anotacoes.map((a) => [a.id, a]));
  const porPerfil: Record<PerfilDescricaoCorporal, MetricasPerfilCorpo> = {
    sfw: metricasVazias(),
    neutro: metricasVazias(),
    nsfw: metricasVazias(),
  };
  let respostasSemAnotacao = 0;

  for (const resposta of respostas) {
    const anotacao = porId.get(resposta.id);
    if (!anotacao) {
      respostasSemAnotacao += 1;
      continue;
    }
    const metricas = porPerfil[resposta.perfil];
    const texto = normalizarTextoCorpo(resposta.descricao);
    metricas.respostas += 1;

    for (const rotulo of anotacao.rotulos) {
      const sinonimos = SINONIMOS[rotulo as RotuloCorpo];
      if (!sinonimos) {
        metricas.rotulosSemRegra += 1;
        continue;
      }
      metricas.totalEsperado += 1;
      if (!sinonimos.some((sinonimo) => texto.includes(normalizarTextoCorpo(sinonimo)))) {
        metricas.omissoes += 1;
      }
    }

    if (!anotacao.conteudoSexualExplicito) {
      metricas.totalNaoSexual += 1;
      if (TERMOS_SEXUALIZANTES.some((termo) => texto.includes(termo))) {
        metricas.sexualizacoesIndevidas += 1;
      }
    }
  }

  for (const perfil of ["sfw", "neutro", "nsfw"] as const) {
    porPerfil[perfil].semResposta = anotacoes.length - porPerfil[perfil].respostas;
  }

  return {
    status: "avaliado",
    base: "comparacao-lexica",
    porPerfil,
    respostasSemAnotacao,
  };
}

export interface ComparacaoPromptsCorpo {
  blocos: Record<PerfilDescricaoCorporal, string>;
  tamanhos: Record<PerfilDescricaoCorporal, number>;
  blocosDistintos: boolean;
  neutroContemInstrucaoNsfw: boolean;
  neutroContemInstrucaoCorporal: boolean;
}

/**
 * Compara os três blocos gerados a partir das **mesmas** marcações. É uma
 * verificação de contrato dos prompts — não uma medição de qualidade do modelo.
 */
export function compararPromptsCorpo(
  quadros: ReadonlyArray<QuadroNsfwPrompt>,
  contexto?: string | null
): ComparacaoPromptsCorpo {
  const blocos: Record<PerfilDescricaoCorporal, string> = {
    sfw: blocoPerfilCorporal("sfw", quadros, contexto),
    neutro: blocoPerfilCorporal("neutro", quadros, contexto),
    nsfw: blocoPerfilCorporal("nsfw", quadros, contexto),
  };
  const neutro = blocos.neutro;
  return {
    blocos,
    tamanhos: {
      sfw: blocos.sfw.length,
      neutro: neutro.length,
      nsfw: blocos.nsfw.length,
    },
    blocosDistintos: blocos.sfw !== neutro && neutro !== blocos.nsfw,
    neutroContemInstrucaoNsfw: neutro.includes("CONTEUDO ADULTO (NSFW)"),
    neutroContemInstrucaoCorporal: neutro.includes("DESCRICAO CORPORAL NEUTRA"),
  };
}
