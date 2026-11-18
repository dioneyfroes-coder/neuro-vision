import type { CadenciaPercepcao } from "./cadencia";

/**
 * Frequencia adaptativa na entrada de pessoas (Fase 4, item 3).
 *
 * O redutor desta pagina e **puro**: recebe numeros de tempo ja medidos pelo
 * chamador e nao consulta relogio de parede. A transicao para `atencao` aumenta
 * a cadencia de amostragem; a volta para `base` exige histerese (quantidade de
 * ciclos sem pessoa **e** tempo minimo desde a ultima evidencia). Assim uma
 * oclusao curta nao derruba a frequencia e o mesmo conjunto de entradas sempre
 * produz o mesmo estado.
 */

export type ModoFrequencia = "base" | "atencao";

export interface ConfigFrequenciaAdaptativa {
  /**
   * Cadencia base. Quando ausente, a cadencia declarada na politica e usada.
   * Tambem serve de fallback para intervalos nao sobrescritos em `cadenciaAtencao`.
   */
  cadenciaBase?: CadenciaPercepcao;
  /** Cadencia usada enquanto ha pessoa observada (sobrescreve a base). */
  cadenciaAtencao: CadenciaPercepcao;
  /** Amostras positivas consecutivas para entrar em `atencao` (padrao: 1). */
  framesParaEntrar?: number;
  /** Amostras sem pessoa para voltar a `base` (padrao: 2). */
  framesParaSair?: number;
  /** Tempo minimo desde a ultima evidencia antes da volta (ms; padrao: 1000). */
  manterAposUltimaEvidenciaMs?: number;
}

export const CONFIG_FREQUENCIA_ADAPTATIVA_PADRAO = {
  framesParaEntrar: 1,
  framesParaSair: 2,
  manterAposUltimaEvidenciaMs: 1000,
} as const satisfies Pick<
  ConfigFrequenciaAdaptativa,
  "framesParaEntrar" | "framesParaSair" | "manterAposUltimaEvidenciaMs"
>;

export interface EstadoFrequenciaAdaptativa {
  modo: ModoFrequencia;
  framesPositivos: number;
  framesSemPessoa: number;
  /** Timestamp monotonico da ultima amostra com pessoa (fornecido pelo chamador). */
  ultimaEvidenciaMs?: number;
  /** Quantidade de transicoes para `atencao` na sessao (diagnostico). */
  ativacoes: number;
}

export function estadoInicialFrequenciaAdaptativa(): EstadoFrequenciaAdaptativa {
  return { modo: "base", framesPositivos: 0, framesSemPessoa: 0, ativacoes: 0 };
}

/** Sinal de presenca consolidado de um ciclo, com tempo ja numérico. */
export interface SinalFrequenciaAdaptativa {
  /** Timestamp monotonico (ms) do ultimo frame do ciclo. */
  tempoMs: number;
  /** Tracks de pessoa vivos no fim do ciclo (o chamador pode descontar saidas). */
  pessoasAtivas: number;
  /** Evento de entrada de pessoa emanado do track de pose neste ciclo. */
  entrouPessoa?: boolean;
  /** Evento de saida de pessoa emanado do track de pose neste ciclo. */
  saiuPessoa?: boolean;
}

function inteiroPositivo(valor: number | undefined, padrao: number): number {
  return typeof valor === "number" && Number.isFinite(valor) && valor >= 1
    ? Math.floor(valor)
    : padrao;
}

/**
 * Avanca o estado da frequencia com um sinal de presenca. Nao muta `estado`.
 * Um tempo nao finito e ignorado para a histerese temporal (a contagem de frames
 * ainda funciona), mantendo a funcao total mesmo com dados incompletos.
 */
export function reduzirFrequenciaAdaptativa(
  estado: EstadoFrequenciaAdaptativa,
  sinal: SinalFrequenciaAdaptativa,
  config: ConfigFrequenciaAdaptativa
): EstadoFrequenciaAdaptativa {
  const framesParaEntrar = inteiroPositivo(
    config.framesParaEntrar,
    CONFIG_FREQUENCIA_ADAPTATIVA_PADRAO.framesParaEntrar
  );
  const framesParaSair = inteiroPositivo(
    config.framesParaSair,
    CONFIG_FREQUENCIA_ADAPTATIVA_PADRAO.framesParaSair
  );
  const manterMs = inteiroPositivo(
    config.manterAposUltimaEvidenciaMs,
    CONFIG_FREQUENCIA_ADAPTATIVA_PADRAO.manterAposUltimaEvidenciaMs
  );
  const tempoMs = Number.isFinite(sinal.tempoMs) ? sinal.tempoMs : undefined;
  const presente = sinal.entrouPessoa === true || sinal.pessoasAtivas > 0;

  if (presente) {
    const framesPositivos = estado.framesPositivos + 1;
    const ativar = estado.modo === "base" && framesPositivos >= framesParaEntrar;
    return {
      modo: ativar ? "atencao" : estado.modo,
      framesPositivos,
      framesSemPessoa: 0,
      ultimaEvidenciaMs: tempoMs ?? estado.ultimaEvidenciaMs,
      ativacoes: estado.ativacoes + (ativar ? 1 : 0),
    };
  }

  const framesSemPessoa = estado.framesSemPessoa + 1;
  const tempoDecorrido =
    tempoMs !== undefined && estado.ultimaEvidenciaMs !== undefined
      ? tempoMs - estado.ultimaEvidenciaMs
      : Number.POSITIVE_INFINITY;
  const desativar =
    estado.modo === "atencao" &&
    framesSemPessoa >= framesParaSair &&
    tempoDecorrido >= manterMs;

  return {
    ...estado,
    framesPositivos: 0,
    framesSemPessoa: desativar ? 0 : framesSemPessoa,
    modo: desativar ? "base" : estado.modo,
    ...(desativar ? { ultimaEvidenciaMs: undefined } : {}),
  };
}

/** Mescla duas cadencias: campos ausentes da atencao herdam da base. */
export function mesclarCadencia(
  base: CadenciaPercepcao | undefined,
  sobrescrita: CadenciaPercepcao | undefined
): CadenciaPercepcao | undefined {
  if (!base && !sobrescrita) return undefined;
  return { ...base, ...sobrescrita };
}

/** Cadencia efetiva de um modo, para alimentar `planejarAmostragem`. */
export function cadenciaParaModo(
  config: ConfigFrequenciaAdaptativa,
  modo: ModoFrequencia,
  cadenciaPolitica?: CadenciaPercepcao
): CadenciaPercepcao | undefined {
  const base = mesclarCadencia(cadenciaPolitica, config.cadenciaBase);
  return modo === "atencao" ? mesclarCadencia(base, config.cadenciaAtencao) : base;
}
