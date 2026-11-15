import type { ResultadoIndisponivel } from "./perception";

/** Subsistemas de percepcao local que podem ter cadencia propria. */
export type SubsistemaPercepcao = ResultadoIndisponivel["subsistema"];

/**
 * Cadencia independente por subsistema (Fase 1.3).
 *
 * Os valores sao **intervalos alvo em ms** entre amostras do subsistema dentro
 * da janela de captura. Um campo ausente (ou `<= 0`) significa "todo frame".
 * A cadencia e uma meta: a taxa efetiva depende do custo de inferencia do
 * hardware e fica registrada em `metricas.amostragem` de cada ciclo.
 *
 * Exemplo: maos a cada 200 ms (5 FPS alvo), pose/deteccao a cada 1000 ms.
 */
export interface CadenciaPercepcao {
  deteccaoMs?: number;
  poseMs?: number;
  maosMs?: number;
  nsfwMs?: number;
}

/** Cadencia de referencia: todos os subsistemas em todos os frames. */
export const CADENCIA_TODOS_OS_FRAMES: CadenciaPercepcao = {};

/** Subsistemas na ordem usada pelas metricas e pelo pipeline. */
export const SUBSISTEMAS_PERCEPCAO: readonly SubsistemaPercepcao[] = [
  "deteccao",
  "pose",
  "maos",
  "nsfw",
];

/** Intervalo configurado para um subsistema (`undefined` = todo frame). */
export function intervaloDaCadencia(
  cadencia: CadenciaPercepcao | undefined,
  subsistema: SubsistemaPercepcao
): number | undefined {
  const valor = cadencia?.[`${subsistema}Ms` as keyof CadenciaPercepcao];
  return typeof valor === "number" && Number.isFinite(valor) && valor > 0 ? valor : undefined;
}

/** Amostragem decidida para um frame: quais subsistemas devem executar. */
export type AmostragemFrame = ReadonlySet<SubsistemaPercepcao>;

/** Todos os subsistemas (frame completo). Reutilizado para evitar alocacao. */
const TODOS: AmostragemFrame = new Set(SUBSISTEMAS_PERCEPCAO);

/**
 * Tolerancia para absorver o jitter da captura: um frame um pouco antes do alvo
 * ainda conta como a amostra daquele intervalo. Limitada para nao antecipar
 * amostras em intervalos longos (ex.: 1000 ms com tolerancia de 250 ms).
 */
function tolerancia(intervaloMs: number): number {
  return Math.min(intervaloMs * 0.1, 100);
}

/**
 * Planeja quais subsistemas rodam em cada frame da janela (funcao pura).
 *
 * Entrada: timestamps monotonos **na ordem de captura**. Saida: um conjunto por
 * frame, sempre do mesmo tamanho. Regras:
 *
 * - o **primeiro frame sempre roda todos** os subsistemas (garante ao menos uma
 *   observacao completa por ciclo e ancora os rastreadores);
 * - cada subsistema com intervalo `I` e amostrado no primeiro frame cujo
 *   deslocamento alcanca o proximo alvo (`0, I, 2I, ...`, com tolerancia de
 *   jitter); depois o alvo avanca para alem do instante atual;
 * - a decisao depende apenas dos timestamps, nunca da ordem de conclusao do
 *   processamento — logo o plano e deterministico mesmo com concorrencia.
 * - timestamps nao finitos sao tratados como o instante do frame anterior, sem
 *   quebrar a sequencia.
 */
export function planejarAmostragem(
  timestampsMs: readonly number[],
  cadencia: CadenciaPercepcao | undefined = CADENCIA_TODOS_OS_FRAMES
): AmostragemFrame[] {
  if (timestampsMs.length === 0) return [];
  const intervalos = SUBSISTEMAS_PERCEPCAO.map((subsistema) =>
    intervaloDaCadencia(cadencia, subsistema)
  );
  // Sem nenhuma cadencia configurada nao ha o que planejar: todos os frames
  // sao completos (comportamento anterior preservado).
  if (intervalos.every((intervalo) => intervalo === undefined)) {
    return timestampsMs.map(() => TODOS);
  }

  const primeiro = timestampsMs[0];
  const proximoAlvo = intervalos.map(() => 0);
  const plano: AmostragemFrame[] = [];
  let deslocamentoAnterior = 0;

  for (let i = 0; i < timestampsMs.length; i += 1) {
    const bruto = timestampsMs[i];
    const deslocamento = Number.isFinite(bruto) ? bruto - primeiro : deslocamentoAnterior;
    deslocamentoAnterior = deslocamento;
    const amostras = new Set<SubsistemaPercepcao>();

    SUBSISTEMAS_PERCEPCAO.forEach((subsistema, indice) => {
      const intervalo = intervalos[indice];
      if (intervalo === undefined || i === 0) {
        amostras.add(subsistema);
        if (intervalo !== undefined) proximoAlvo[indice] = intervalo;
        return;
      }
      if (deslocamento + tolerancia(intervalo) >= proximoAlvo[indice]) {
        amostras.add(subsistema);
        // Avanca alem do instante atual: uma captura esparsa continua alinhada
        // aos multiplos do intervalo em vez de amostrar varios alvos de uma vez.
        while (proximoAlvo[indice] <= deslocamento) proximoAlvo[indice] += intervalo;
      }
    });

    plano.push(amostras);
  }
  return plano;
}

/** Metrica de amostragem de um subsistema num ciclo. */
export interface AmostragemSubsistemaCiclo {
  /** Quantos frames realmente executaram o subsistema. */
  amostrados: number;
  /** Intervalo alvo configurado (ms); ausente quando roda em todo frame. */
  intervaloAlvoMs?: number;
  /** Intervalo medio entre amostras dentro da janela (ms), com 2+ amostras. */
  intervaloMedioMs?: number;
  /** Taxa media efetiva de amostragem (FPS), com 2+ amostras. */
  fpsEfetivo?: number;
}

/** Resumo da amostragem de todos os subsistemas num ciclo. */
export interface AmostragemCiclo {
  /** Janela real entre o primeiro e o ultimo frame do plano (ms). */
  janelaMs: number;
  porSubsistema: Partial<Record<SubsistemaPercepcao, AmostragemSubsistemaCiclo>>;
}

/**
 * Deriva as metricas de amostragem a partir do plano aplicado aos timestamps.
 * `fpsEfetivo` usa o intervalo medio entre amostras — nao o custo de inferencia:
 * mede **quando** o subsistema foi chamado, nao quanto tempo levou.
 */
export function resumirAmostragem(
  timestampsMs: readonly number[],
  plano: readonly AmostragemFrame[],
  cadencia: CadenciaPercepcao | undefined
): AmostragemCiclo {
  const janelaMs =
    timestampsMs.length >= 2 ? Math.max(0, timestampsMs[timestampsMs.length - 1] - timestampsMs[0]) : 0;
  const porSubsistema: AmostragemCiclo["porSubsistema"] = {};

  for (const subsistema of SUBSISTEMAS_PERCEPCAO) {
    const amostrados = plano.reduce(
      (total, amostras) => total + (amostras.has(subsistema) ? 1 : 0),
      0
    );
    if (amostrados === 0) continue;
    const intervaloAlvoMs = intervaloDaCadencia(cadencia, subsistema);
    const metrica: AmostragemSubsistemaCiclo = { amostrados };
    if (intervaloAlvoMs !== undefined) metrica.intervaloAlvoMs = intervaloAlvoMs;
    if (amostrados >= 2 && janelaMs > 0) {
      const intervaloMedioMs = Math.round(janelaMs / (amostrados - 1));
      metrica.intervaloMedioMs = intervaloMedioMs;
      metrica.fpsEfetivo = intervaloMedioMs > 0 ? Math.round((1000 / intervaloMedioMs) * 10) / 10 : undefined;
      if (metrica.fpsEfetivo === undefined) delete metrica.fpsEfetivo;
    }
    porSubsistema[subsistema] = metrica;
  }

  return { janelaMs, porSubsistema };
}
