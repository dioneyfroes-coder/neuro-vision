/**
 * Avaliação de iluminação e oclusão (Fase 7) — regra pura, sem I/O e sem relógio.
 *
 * Os roteiros sintéticos em `tests/qualidade-eventos.test.ts` provam que a
 * política reage a contraluz/oclusão com `baixa_confianca`. Esta camada mede se
 * essa reação acontece no tempo certo quando existe verdade-base anotada, e
 * distingue três estados: `APROVADO`, `REPROVADO` e `INCONCLUSIVO` (sem dados
 * revisados). Nenhum número é inventado quando a anotação é rascunho.
 */

/** Alvos de condição com verdade-base exigida pelo roteiro. */
export const CONDICOES_ALVO = ["oclusao_parcial", "contraluz", "ambiente_escuro"] as const;

export type CondicaoAlvo = (typeof CONDICOES_ALVO)[number];

/** Classes que indicam que a política classificou mal uma condição degradada. */
export const CLASSES_POLITICA_INCORRETA = [
  "movimento",
  "nova_entidade",
  "desaparecimento",
] as const;

export type ClassificacaoEvento =
  | "baixa_confianca"
  | (typeof CLASSES_POLITICA_INCORRETA)[number]
  | "resumo"
  | "outro";

/** Um intervalo anotado em ms desde o início do clipe. */
export interface IntervaloCondicao {
  inicioMs: number;
  fimMs: number;
}

/** Verdade-base humana para uma condição em um clipe. */
export interface AnotacaoCondicao extends IntervaloCondicao {
  condicao: CondicaoAlvo;
  /** `false` exclui o intervalo de precisão/recall e o conta à parte. */
  determinavel?: boolean;
  visibilidade?: "clara" | "parcial" | "ocluida" | "impossivel_de_determinar";
}

/** Anotação completa de um clipe. `revisada` é o gate de evidência. */
export interface AnotacaoClipCondicoes {
  clip: string;
  duracaoMs: number;
  revisada: boolean;
  metodoRevisao?: string;
  eventos: AnotacaoCondicao[];
}

/** Evento observado, com o instante em ms desde o início do clipe. */
export interface EventoCondicao {
  clip: string;
  classe: ClassificacaoEvento;
  emMs: number;
  /** Opcional: intervalo real do evento; quando ausente, é tratado como ponto. */
  inicioMs?: number;
  fimMs?: number;
  motivo?: string;
}

export interface OpcoesAvaliacaoCondicoes {
  /** Coeficiente de sobreposição mínimo (interseção / menor intervalo). */
  sobreposicaoMinima?: number;
  /** Tolerância aplicada ao evento para compensar a cadência de amostragem. */
  toleranciaMs?: number;
  ocorrenciasMinimas?: number;
  clipesNegativosMinimos?: number;
  maxFalsosPositivosPorMinuto?: number;
  minPrecisao?: number;
  minRecall?: number;
  condicoes?: readonly CondicaoAlvo[];
}

export interface CorrespondenciaCondicao {
  anotacaoIndex: number;
  eventoIndex: number;
  sobreposicao: number;
}

export interface ResultadoCondicao {
  condicao: CondicaoAlvo;
  esperados: number;
  acertos: number;
  falsosPositivos: number;
  falsosNegativos: number;
  indeterminados: number;
  precisao: number | null;
  recall: number | null;
  falsosPositivosPorMinuto: number;
  violacoesPolitica: number;
  correspondencias: CorrespondenciaCondicao[];
}

export type VereditoCondicoes = "APROVADO" | "REPROVADO" | "INCONCLUSIVO";

export interface ResultadoAvaliacaoCondicoes {
  porCondicao: Record<CondicaoAlvo, ResultadoCondicao>;
  /** Falhas de métrica vêm primeiro; pendências de dados vêm depois. */
  problemas: string[];
  veredito: VereditoCondicoes;
}

const PADRAO: Required<Omit<OpcoesAvaliacaoCondicoes, "condicoes">> = {
  sobreposicaoMinima: 0.5,
  toleranciaMs: 2_000,
  ocorrenciasMinimas: 3,
  clipesNegativosMinimos: 2,
  maxFalsosPositivosPorMinuto: 1,
  minPrecisao: 0.9,
  minRecall: 0.8,
};

export function ehCondicaoAlvo(valor: string): valor is CondicaoAlvo {
  return (CONDICOES_ALVO as readonly string[]).includes(valor);
}

function resultadoVazio(condicao: CondicaoAlvo): ResultadoCondicao {
  return {
    condicao,
    esperados: 0,
    acertos: 0,
    falsosPositivos: 0,
    falsosNegativos: 0,
    indeterminados: 0,
    precisao: null,
    recall: null,
    falsosPositivosPorMinuto: 0,
    violacoesPolitica: 0,
    correspondencias: [],
  };
}

/**
 * Coeficiente de sobreposição entre o intervalo do evento (com tolerância) e a
 * janela anotada. Usar o menor intervalo como denominador evita penalizar um
 * evento pontual cuja cadência de amostragem é mais grossa que a anotação.
 */
export function sobreposicaoComAnotacao(
  anotacao: IntervaloCondicao,
  evento: EventoCondicao,
  toleranciaMs: number
): number {
  const inicioBruto = evento.inicioMs ?? evento.emMs;
  const fimBruto = Math.max(evento.fimMs ?? evento.emMs, inicioBruto);
  const inicioEvento = inicioBruto - toleranciaMs;
  const fimEvento = fimBruto + toleranciaMs;
  const inicio = Math.max(inicioEvento, anotacao.inicioMs);
  const fim = Math.min(fimEvento, anotacao.fimMs);
  const intersecao = Math.max(0, fim - inicio);
  if (intersecao === 0) return 0;
  const menorIntervalo = Math.max(
    1,
    Math.min(fimEvento - inicioEvento, anotacao.fimMs - anotacao.inicioMs)
  );
  return Math.min(1, intersecao / menorIntervalo);
}

function minutosPorClip(anotacoes: readonly AnotacaoClipCondicoes[]): number {
  const vistos = new Set<string>();
  let total = 0;
  for (const anotacao of anotacoes) {
    if (vistos.has(anotacao.clip)) continue;
    vistos.add(anotacao.clip);
    total += Math.max(0, anotacao.duracaoMs);
  }
  return total / 60_000;
}

function distanciaAteJanela(intervalo: IntervaloCondicao, instante: number): number {
  if (instante < intervalo.inicioMs) return intervalo.inicioMs - instante;
  if (instante > intervalo.fimMs) return instante - intervalo.fimMs;
  return 0;
}

interface Candidatura {
  anotacaoIndex: number;
  eventoIndex: number;
  sobreposicao: number;
  distancia: number;
}

/**
 * Compara verdade-base e eventos observados. A política esperada para
 * contraluz/oclusão é `baixa_confianca`; classificar o trecho como movimento,
 * nova entidade ou desaparecimento é violação explícita, não acerto.
 */
export function avaliarCondicoes(
  anotacoes: readonly AnotacaoClipCondicoes[],
  eventos: readonly EventoCondicao[],
  opcoes: OpcoesAvaliacaoCondicoes = {}
): ResultadoAvaliacaoCondicoes {
  const cfg = { ...PADRAO, ...opcoes };
  const condicoes = opcoes.condicoes ?? CONDICOES_ALVO;
  // Rascunho não é verdade-base: é ignorado no cálculo e vira pendência.
  const revisadas = anotacoes.filter((anotacao) => anotacao.revisada);
  const rascunhos = anotacoes.length - revisadas.length;
  const porCondicao = {} as Record<CondicaoAlvo, ResultadoCondicao>;
  for (const condicao of CONDICOES_ALVO) porCondicao[condicao] = resultadoVazio(condicao);

  const indicesPorClip = new Map<string, number[]>();
  eventos.forEach((evento, indice) => {
    const lista = indicesPorClip.get(evento.clip) ?? [];
    lista.push(indice);
    indicesPorClip.set(evento.clip, lista);
  });

  const eventosCasados = new Set<number>();
  const violacoesVistas = new Set<string>();

  revisadas.forEach((anotacaoClip, anotacaoIndex) => {
    const indices = indicesPorClip.get(anotacaoClip.clip) ?? [];
    anotacaoClip.eventos.forEach((alvo) => {
      const resultado = porCondicao[alvo.condicao];
      if (!resultado) return;
      resultado.esperados += 1;
      if (alvo.determinavel === false) {
        resultado.indeterminados += 1;
        return;
      }

      const centro = (alvo.inicioMs + alvo.fimMs) / 2;
      const candidaturas: Candidatura[] = [];
      for (const eventoIndex of indices) {
        const evento = eventos[eventoIndex]!;
        if (evento.classe !== "baixa_confianca") continue;
        if (eventosCasados.has(eventoIndex)) continue;
        const sobreposicao = sobreposicaoComAnotacao(alvo, evento, cfg.toleranciaMs);
        if (sobreposicao < cfg.sobreposicaoMinima) continue;
        candidaturas.push({
          anotacaoIndex,
          eventoIndex,
          sobreposicao,
          distancia: Math.abs(evento.emMs - centro),
        });
      }
      candidaturas.sort((a, b) => b.sobreposicao - a.sobreposicao || a.distancia - b.distancia);
      const escolhida = candidaturas[0];
      if (escolhida) {
        eventosCasados.add(escolhida.eventoIndex);
        resultado.acertos += 1;
        resultado.correspondencias.push({
          anotacaoIndex: escolhida.anotacaoIndex,
          eventoIndex: escolhida.eventoIndex,
          sobreposicao: escolhida.sobreposicao,
        });
      } else {
        resultado.falsosNegativos += 1;
      }

      for (const eventoIndex of indices) {
        const evento = eventos[eventoIndex]!;
        if (!(CLASSES_POLITICA_INCORRETA as readonly string[]).includes(evento.classe)) continue;
        if (
          evento.emMs < alvo.inicioMs - cfg.toleranciaMs ||
          evento.emMs > alvo.fimMs + cfg.toleranciaMs
        ) {
          continue;
        }
        const chave = `${alvo.condicao}:${eventoIndex}`;
        if (violacoesVistas.has(chave)) continue;
        violacoesVistas.add(chave);
        resultado.violacoesPolitica += 1;
      }
    });
  });

  // Um `baixa_confianca` sem janela anotada é falso positivo **da condição mais
  // próxima naquele clipe**. Sem anotação no clipe, não há verdade-base para
  // classificá-lo e nada é inventado.
  eventos.forEach((evento, eventoIndex) => {
    if (evento.classe !== "baixa_confianca" || eventosCasados.has(eventoIndex)) return;
    let melhorCondicao: CondicaoAlvo | undefined;
    let menorDistancia = Number.POSITIVE_INFINITY;
    for (const anotacao of revisadas) {
      if (anotacao.clip !== evento.clip) continue;
      for (const alvo of anotacao.eventos) {
        const distancia = distanciaAteJanela(alvo, evento.emMs);
        if (distancia < menorDistancia) {
          menorDistancia = distancia;
          melhorCondicao = alvo.condicao;
        }
      }
    }
    if (melhorCondicao) porCondicao[melhorCondicao]!.falsosPositivos += 1;
  });

  const minutos = minutosPorClip(revisadas);
  const falhas: string[] = [];
  const pendencias: string[] = [];

  for (const condicao of condicoes) {
    const resultado = porCondicao[condicao]!;
    const denominadorPrecisao = resultado.acertos + resultado.falsosPositivos;
    const denominadorRecall = resultado.acertos + resultado.falsosNegativos;
    resultado.precisao =
      denominadorPrecisao > 0 ? resultado.acertos / denominadorPrecisao : null;
    resultado.recall = denominadorRecall > 0 ? resultado.acertos / denominadorRecall : null;
    resultado.falsosPositivosPorMinuto = minutos > 0 ? resultado.falsosPositivos / minutos : 0;

    if (resultado.violacoesPolitica > 0) {
      falhas.push(
        `${condicao}: ${resultado.violacoesPolitica} evento(s) classificado(s) como movimento/nova entidade/desaparecimento em janela degradada`
      );
    }
    if (resultado.falsosPositivosPorMinuto > cfg.maxFalsosPositivosPorMinuto) {
      falhas.push(
        `${condicao}: ${resultado.falsosPositivosPorMinuto.toFixed(2)} falsos positivos/min acima de ${cfg.maxFalsosPositivosPorMinuto}`
      );
    }
    if (resultado.precisao !== null && resultado.precisao < cfg.minPrecisao) {
      falhas.push(`${condicao}: precisão ${resultado.precisao.toFixed(2)} abaixo de ${cfg.minPrecisao}`);
    }
    if (resultado.recall !== null && resultado.recall < cfg.minRecall) {
      falhas.push(`${condicao}: recall ${resultado.recall.toFixed(2)} abaixo de ${cfg.minRecall}`);
    }
  }

  if (rascunhos > 0) {
    pendencias.push(
      `${rascunhos} anotação(ões) em rascunho ignorada(s): apenas revisada conta como evidência`
    );
  }
  if (revisadas.length === 0) {
    pendencias.push("nenhuma anotação revisada: não há evidência para aceite");
  }
  for (const condicao of condicoes) {
    const positivos = revisadas.reduce(
      (total, anotacao) =>
        total +
        anotacao.eventos.filter(
          (evento) => evento.condicao === condicao && evento.determinavel !== false
        ).length,
      0
    );
    if (positivos < cfg.ocorrenciasMinimas) {
      pendencias.push(
        `${condicao}: ${positivos} ocorrência(s) revisada(s), mínimo ${cfg.ocorrenciasMinimas}`
      );
    }
  }
  const negativos = revisadas.filter((anotacao) => anotacao.eventos.length === 0).length;
  if (negativos < cfg.clipesNegativosMinimos) {
    pendencias.push(
      `clipes negativos revisados: ${negativos}, mínimo ${cfg.clipesNegativosMinimos}`
    );
  }

  const veredito: VereditoCondicoes =
    falhas.length > 0 ? "REPROVADO" : pendencias.length > 0 ? "INCONCLUSIVO" : "APROVADO";

  return { porCondicao, problemas: [...falhas, ...pendencias], veredito };
}
