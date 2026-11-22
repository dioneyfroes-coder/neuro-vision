import { TIPOS_IGNORADOS_PADRAO } from "./constantes.mjs";
import { tiposCompativeis } from "./eventos.mjs";

/**
 * Razao com denominador explicito. Sem denominador (zero/ausente) a metrica e
 * N/A (`null`) e deve ficar FORA de medias — nao existe "1" por ausencia de
 * amostra. Vale para recall sem positivos esperados e FP/min sem duracao.
 */
function taxa(numerador, denominador) {
  if (!Number.isFinite(denominador) || denominador <= 0) return null;
  return numerador / denominador;
}

function calcularDuracaoMs(esperados, detectados) {
  const pontos = [...esperados.map((e) => e.em), ...detectados.map((d) => d.em)];
  if (!pontos.length) return 0;
  return Math.max(0, Math.max(...pontos) - Math.min(...pontos));
}

/**
 * Atraso com sinal: detecção posterior ao esperado é positivo; anterior é
 * negativo. Sem correspondência o valor é `null` (N/A) e nunca entra em média.
 */
export function estatisticasAtraso(correspondencias = []) {
  const valores = correspondencias
    .map((c) => (Number.isFinite(c.detectado?.em) && Number.isFinite(c.esperado?.em)
      ? c.detectado.em - c.esperado.em
      : Number.isFinite(c.atrasoMs) ? c.atrasoMs : null))
    .filter((n) => Number.isFinite(n));
  if (!valores.length) {
    return { amostras: 0, mediaMs: null, p95Ms: null, minimoMs: null, maximoMs: null };
  }
  const ordenados = [...valores].sort((a, b) => a - b);
  const indice = Math.min(ordenados.length - 1, Math.ceil(0.95 * ordenados.length) - 1);
  return {
    amostras: valores.length,
    mediaMs: valores.reduce((a, b) => a + b, 0) / valores.length,
    p95Ms: ordenados[Math.max(0, indice)],
    minimoMs: ordenados[0],
    maximoMs: ordenados[ordenados.length - 1],
  };
}

/**
 * Compara eventos esperados com os detectados e calcula precisao, recall,
 * mudancas perdidas e falsos positivos por minuto.
 *
 * Recebe listas ja com `em` (ms) numerico. Para cada evento esperado procura a
 * deteccao de **tipo compativel** mais proxima dentro da tolerancia; cada
 * deteccao so pode casar uma vez. O escopo de objeto exige origem e rotulo
 * conhecidos para nao confundir movimento de pessoa com objeto deslocado.
 *
 * Metricas de razao sem denominador (recall sem positivos esperados, precisao
 * sem deteccoes, FP/min sem duracao) valem `null` (N/A) e nao entram em medias.
 */
export function compararEventos({
  esperados = [],
  detectados = [],
  escopoClasse,
  toleranciaMs = 3000,
  ignorados = TIPOS_IGNORADOS_PADRAO,
  duracaoMs,
} = {}) {
  const ignoradosSet = new Set(ignorados);
  const escopoDeObjeto = escopoClasse === "movimento_objeto.objeto_deslocado";
  const movimentos = escopoDeObjeto
    ? detectados.filter((d) => d.tipo === "movimento" && !ignoradosSet.has(d.tipo))
    : [];
  const classificadosNoEscopo = movimentos.filter(
    (d) =>
      d.origensSinal?.includes("objetos") &&
      typeof d.rotuloObjeto === "string" &&
      d.rotuloObjeto.trim().length > 0
  );
  const semClassificacaoEscopo = movimentos.length - classificadosNoEscopo.length;
  const movimentosPessoaExcluidos = classificadosNoEscopo.filter((d) =>
    ["person", "pessoa"].includes(d.rotuloObjeto.trim().toLowerCase())
  ).length;
  const candidatos = detectados.filter((d) => {
    if (ignoradosSet.has(d.tipo)) return false;
    if (!escopoDeObjeto) return true;
    return (
      classificadosNoEscopo.includes(d) &&
      !["person", "pessoa"].includes(d.rotuloObjeto.trim().toLowerCase())
    );
  });
  const noEscopo = esperados.filter(
    (e) =>
      escopoClasse !== "movimento_objeto.objeto_deslocado" ||
      (e.categoria === "movimento_objeto" && e.classe === "objeto_deslocado")
  );
  const avaliaveis = noEscopo.filter((e) => e.determinavel !== false);

  const usados = new Set();
  const correspondencias = [];
  const perdidos = [];
  for (const esperado of avaliaveis) {
    let melhorIndice = -1;
    let melhorDistancia = Infinity;
    for (let i = 0; i < candidatos.length; i++) {
      if (usados.has(i)) continue;
      const cand = candidatos[i];
      if (!tiposCompativeis(esperado.tipo, cand.tipo)) continue;
      const distancia = Math.abs(cand.em - esperado.em);
      if (distancia <= toleranciaMs && distancia < melhorDistancia) {
        melhorIndice = i;
        melhorDistancia = distancia;
      }
    }
    if (melhorIndice >= 0) {
      usados.add(melhorIndice);
      correspondencias.push({
        esperado,
        detectado: candidatos[melhorIndice],
        distanciaMs: melhorDistancia,
        atrasoMs: candidatos[melhorIndice].em - esperado.em,
      });
    } else {
      perdidos.push(esperado);
    }
  }

  const falsosPositivos = candidatos.filter((_, i) => !usados.has(i));
  const tp = correspondencias.length;
  const fp = falsosPositivos.length;
  const fn = perdidos.length;
  const duracaoEfetivaMs =
    duracaoMs && duracaoMs > 0 ? duracaoMs : calcularDuracaoMs(avaliaveis, candidatos);

  return {
    esperados: avaliaveis.length,
    indeterminados: noEscopo.length - avaliaveis.length,
    foraEscopo: esperados.length - noEscopo.length,
    escopoClasse,
    semClassificacaoEscopo,
    movimentosPessoaExcluidos,
    detectados: candidatos.length,
    verdadeirosPositivos: tp,
    perdidos: fn,
    falsosPositivos: fp,
    precisao: taxa(tp, tp + fp),
    recall: taxa(tp, tp + fn),
    /** Sem mudancas esperadas o denominador nao existe: N/A (`null`), nao 0. */
    proporcaoPerdidas: taxa(fn, tp + fn),
    falsosPositivosPorMinuto:
      Number.isFinite(duracaoEfetivaMs) && duracaoEfetivaMs > 0
        ? fp / (duracaoEfetivaMs / 60_000)
        : null,
    duracaoMs: duracaoEfetivaMs,
    atraso: estatisticasAtraso(correspondencias),
    correspondencias,
    perdidosDetalhe: perdidos,
    falsosPositivosDetalhe: falsosPositivos,
  };
}
