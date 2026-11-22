/**
 * Comparação determinística entre respostas multimodais estruturadas e
 * anotações humanas (Fase 6, item 8).
 *
 * Esta rotina **não mede precisão do sistema em condições reais**: ela compara
 * texto/afirmações já estruturadas com o que um humano marcou. Só produz números
 * de correspondência quando a anotação foi revisada e pertence ao conjunto de
 * avaliação; mesmo assim o resultado é uma métrica léxica daquele conjunto,
 * nunca uma taxa universal. Sem anotação revisada, `precisao`/`recall` ficam
 * ausentes e o motivo é registrado. As taxas, quando existem, são comparações
 * léxicas daquele conjunto — não uma taxa universal de precisão.
 */
import type { StatusEvidencia } from "./evidencia";

export interface AfirmacaoHumana {
  texto: string;
  tipo?: string;
  natureza?: "observada" | "inferida";
  statusEvidencia?: StatusEvidencia;
}

export interface AnotacaoParaComparacaoMultimodal {
  clip?: string;
  conjunto?: "eval" | "tuning";
  revisao?: { status?: string; metodo?: string };
  afirmacoesEsperadas?: readonly AfirmacaoHumana[];
  /** Eventos anotados no formato v2; usados quando não há afirmações explícitas. */
  eventos?: readonly {
    descricao?: string;
    classe?: string;
    tipo?: string;
    determinavel?: boolean;
    visibilidade?: string;
  }[];
}

export interface RespostaParaComparacaoMultimodal {
  cycleId?: string;
  resumo?: string;
  acoes?: readonly { descricao: string; natureza?: string }[];
  participantes?: readonly { descricao: string }[];
  evidencias?: readonly string[];
  evidenciasInvalidas?: readonly string[];
  afirmacoesSemEvidencia?: readonly { texto: string }[];
  duracaoMs?: number;
  tokens?: number;
  modelo?: string;
}

export interface CorrespondenciaAfirmacao {
  esperada: string;
  encontrada?: string;
  similaridade: number;
  natureza?: string;
  statusEvidencia?: StatusEvidencia;
}

export interface ComparacaoMultimodal {
  clip?: string;
  limiteSimilaridade: number;
  totalEsperado: number;
  totalObservado: number;
  acertos: number;
  faltantes: string[];
  extras: string[];
  correspondencias: CorrespondenciaAfirmacao[];
  evidenciasInvalidas: number;
  afirmacoesSemEvidencia: number;
  /** Preenchidos somente quando há anotação revisada de avaliação. */
  precisao?: number;
  recall?: number;
  motivoMetricasIndisponiveis?: string;
  /** Latência/custo observados nos registros, nunca inferidos. */
  latenciaMs: { amostras: number; media?: number; max?: number };
  tokens: { amostras: number; total?: number; medio?: number };
}

const PARADAS = new Set([
  "a", "as", "ao", "aos", "de", "do", "da", "dos", "das", "em", "no", "na",
  "nos", "nas", "por", "para", "com", "sem", "e", "ou", "o", "os", "um",
  "uma", "uns", "umas", "que", "se", "pela", "pelas", "pelo", "pelos",
]);

/** Normaliza acentos/caixa/pontuação para comparação léxica determinística. */
export function tokenizerAfirmacao(texto: string): string[] {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((palavra) => palavra.length > 1 && !PARADAS.has(palavra));
}

/** Interseção sobre união dos tokens (Jaccard), em [0, 1]. */
export function similaridadeAfirmacoes(a: string, b: string): number {
  const esquerda = new Set(tokenizerAfirmacao(a));
  const direita = new Set(tokenizerAfirmacao(b));
  if (esquerda.size === 0 || direita.size === 0) return 0;
  let intersecao = 0;
  for (const token of esquerda) if (direita.has(token)) intersecao += 1;
  const uniao = new Set([...esquerda, ...direita]).size;
  return uniao === 0 ? 0 : intersecao / uniao;
}

function afirmacoesEsperadas(anotacao: AnotacaoParaComparacaoMultimodal): AfirmacaoHumana[] {
  if (anotacao.afirmacoesEsperadas?.length) return [...anotacao.afirmacoesEsperadas];
  return (anotacao.eventos ?? [])
    .filter((evento) => evento.determinavel !== false && evento.visibilidade !== "impossivel_de_determinar")
    .map((evento) => ({
      texto: evento.descricao?.trim() || evento.classe?.trim() || "",
      ...(evento.tipo ? { tipo: evento.tipo } : {}),
    }))
    .filter((afirmacao) => afirmacao.texto !== "");
}

interface AfirmacaoObservada {
  texto: string;
  natureza?: string;
}

function afirmacoesObservadas(resposta: RespostaParaComparacaoMultimodal): AfirmacaoObservada[] {
  const observadas: AfirmacaoObservada[] = [];
  for (const acao of resposta.acoes ?? []) {
    if (acao.descricao.trim()) {
      observadas.push({ texto: acao.descricao, ...(acao.natureza ? { natureza: acao.natureza } : {}) });
    }
  }
  for (const participante of resposta.participantes ?? []) {
    if (participante.descricao.trim()) observadas.push({ texto: participante.descricao });
  }
  if (observadas.length === 0 && resposta.resumo?.trim()) {
    observadas.push({ texto: resposta.resumo });
  }
  return observadas;
}

function arredondar(valor: number): number {
  return Math.round(valor * 1000) / 1000;
}

/** Compara um lote de respostas com a anotação e devolve métricas auditáveis. */
export function compararRespostasMultimodais(
  anotacao: AnotacaoParaComparacaoMultimodal,
  respostas: readonly RespostaParaComparacaoMultimodal[],
  opcoes: { limiteSimilaridade?: number } = {}
): ComparacaoMultimodal {
  const limite = opcoes.limiteSimilaridade ?? 0.5;
  const esperadas = afirmacoesEsperadas(anotacao);
  const observadas = respostas.flatMap(afirmacoesObservadas);
  const usadas = new Set<number>();
  const correspondencias: CorrespondenciaAfirmacao[] = [];

  for (const esperada of esperadas) {
    let melhorIndice = -1;
    let melhorSimilaridade = 0;
    observadas.forEach((observada, indice) => {
      if (usadas.has(indice)) return;
      const similaridade = similaridadeAfirmacoes(esperada.texto, observada.texto);
      if (similaridade > melhorSimilaridade) {
        melhorSimilaridade = similaridade;
        melhorIndice = indice;
      }
    });
    if (melhorIndice >= 0 && melhorSimilaridade >= limite) {
      usadas.add(melhorIndice);
      const encontrada = observadas[melhorIndice];
      correspondencias.push({
        esperada: esperada.texto,
        encontrada: encontrada.texto,
        similaridade: arredondar(melhorSimilaridade),
        ...(encontrada.natureza ? { natureza: encontrada.natureza } : {}),
        ...(esperada.statusEvidencia ? { statusEvidencia: esperada.statusEvidencia } : {}),
      });
    } else {
      correspondencias.push({
        esperada: esperada.texto,
        similaridade: arredondar(melhorSimilaridade),
        ...(esperada.statusEvidencia ? { statusEvidencia: esperada.statusEvidencia } : {}),
      });
    }
  }

  const faltantes = correspondencias.filter((c) => !c.encontrada).map((c) => c.esperada);
  const extras = observadas.filter((_, indice) => !usadas.has(indice)).map((o) => o.texto);
  const telemetria = agregarTelemetriaMultimodal(respostas);
  const comparacao: ComparacaoMultimodal = {
    ...(anotacao.clip ? { clip: anotacao.clip } : {}),
    limiteSimilaridade: limite,
    totalEsperado: esperadas.length,
    totalObservado: observadas.length,
    acertos: correspondencias.length - faltantes.length,
    faltantes,
    extras,
    correspondencias,
    evidenciasInvalidas: respostas.reduce((total, r) => total + (r.evidenciasInvalidas?.length ?? 0), 0),
    afirmacoesSemEvidencia: respostas.reduce(
      (total, r) => total + (r.afirmacoesSemEvidencia?.length ?? 0),
      0
    ),
    latenciaMs: telemetria.latenciaMs,
    tokens: telemetria.tokens,
  };

  const revisada = anotacao.revisao?.status === "revisada";
  if (!revisada || anotacao.conjunto !== "eval" || esperadas.length === 0) {
    comparacao.motivoMetricasIndisponiveis =
      "anotacao_sem_revisao_eval_ou_sem_afirmacoes_referencia";
    return comparacao;
  }
  if (comparacao.totalObservado > 0) {
    comparacao.precisao = arredondar(comparacao.acertos / comparacao.totalObservado);
  }
  comparacao.recall = arredondar(comparacao.acertos / comparacao.totalEsperado);
  return comparacao;
}

/** Agrega apenas latência/tokens efetivamente informados pelas respostas. */
export function agregarTelemetriaMultimodal(
  respostas: readonly RespostaParaComparacaoMultimodal[]
): Pick<ComparacaoMultimodal, "latenciaMs" | "tokens"> {
  const duracoes = respostas
    .map((r) => r.duracaoMs)
    .filter((v): v is number => Number.isFinite(v) && (v as number) >= 0);
  const tokens = respostas
    .map((r) => r.tokens)
    .filter((v): v is number => Number.isFinite(v) && (v as number) >= 0);
  return {
    latenciaMs: {
      amostras: duracoes.length,
      ...(duracoes.length
        ? {
            media: arredondar(duracoes.reduce((a, b) => a + b, 0) / duracoes.length),
            max: Math.max(...duracoes),
          }
        : {}),
    },
    tokens: {
      amostras: tokens.length,
      ...(tokens.length
        ? {
            total: tokens.reduce((a, b) => a + b, 0),
            medio: arredondar(tokens.reduce((a, b) => a + b, 0) / tokens.length),
          }
        : {}),
    },
  };
}
