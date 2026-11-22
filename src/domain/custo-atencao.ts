/**
 * Agregador de custo por estado de atenção (Fase 3).
 *
 * As amostras **não** são estimativas: cada campo só entra no agregado quando o
 * chamador o mediu. Contadores ausentes permanecem `undefined` em vez de virar
 * zero — zero é uma medição válida e não pode ser confundido com "não medido".
 */
import type { EstadoAtencao } from "./seguranca-atencao";
import type { SubsistemaPercepcao } from "./cadencia";

export interface AmostraCustoAtencao {
  estado: EstadoAtencao;
  duracaoMs: number;
  falhas?: number;
  /** Amostras executadas por subsistema (não inclui `naoAmostrado`). */
  amostras?: Partial<Record<SubsistemaPercepcao, number>>;
  /** Quadros não amostrados por subsistema (cadência, nunca falha). */
  naoAmostrados?: Partial<Record<SubsistemaPercepcao, number>>;
  /** Duração da inferência do subsistema nesta amostra, em ms. */
  inferenciaMs?: Partial<Record<SubsistemaPercepcao, number>>;
  picoMemoriaBytes?: number;
  mudancasCena?: number;
  quadrosCorrelatos?: number;
  bytesCorrelatos?: number;
  /** Quadros de vídeo sem cobertura confirmada no intervalo. */
  quadrosSemCobertura?: number;
}

export interface CustoEstadoAtencao {
  estado: EstadoAtencao;
  amostras: number;
  duracaoMs: number;
  falhas: number;
  fpsEfetivo?: number;
  amostrasPorSubsistema: Partial<Record<SubsistemaPercepcao, number>>;
  naoAmostradosPorSubsistema: Partial<Record<SubsistemaPercepcao, number>>;
  /** Somas e contagens separadas evitam média de médias entre amostras. */
  inferenciaTotalMs: Partial<Record<SubsistemaPercepcao, number>>;
  inferenciaAmostras: Partial<Record<SubsistemaPercepcao, number>>;
  inferenciaMediaMs?: Partial<Record<SubsistemaPercepcao, number>>;
  picoMemoriaBytes?: number;
  mudancasCena: number;
  quadrosCorrelatos: number;
  bytesCorrelatos: number;
  quadrosSemCobertura: number;
}

export interface ResumoCustoAtencao {
  porEstado: Partial<Record<EstadoAtencao, CustoEstadoAtencao>>;
  totalAmostras: number;
  totalDuracaoMs: number;
}

const SUBSISTEMAS: readonly SubsistemaPercepcao[] = ["deteccao", "pose", "maos", "nsfw"];

function numero(valor: number | undefined, padrao = 0): number {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : padrao;
}

/** Cria um resumo vazio, útil para iniciar a telemetria de uma sessão. */
export function resumoVazioCustoAtencao(): ResumoCustoAtencao {
  return { porEstado: {}, totalAmostras: 0, totalDuracaoMs: 0 };
}

/**
 * Acumula uma amostra sem mutar o resumo anterior. O estado é o único campo
 * obrigatório; duração ausente/não finita entra como zero e não gera FPS.
 */
export function acumularCustoAtencao(
  anterior: ResumoCustoAtencao,
  amostra: AmostraCustoAtencao
): ResumoCustoAtencao {
  const atual = anterior.porEstado[amostra.estado];
  const duracao = numero(amostra.duracaoMs);
  const inferenciaTotalMs: Partial<Record<SubsistemaPercepcao, number>> = {
    ...(atual?.inferenciaTotalMs ?? {}),
  };
  const inferenciaAmostras: Partial<Record<SubsistemaPercepcao, number>> = {
    ...(atual?.inferenciaAmostras ?? {}),
  };

  for (const subsistema of SUBSISTEMAS) {
    const valor = amostra.inferenciaMs?.[subsistema];
    if (typeof valor === "number" && Number.isFinite(valor)) {
      inferenciaTotalMs[subsistema] = numero(inferenciaTotalMs[subsistema]) + valor;
      inferenciaAmostras[subsistema] = numero(inferenciaAmostras[subsistema]) + 1;
    }
  }

  const proximo: CustoEstadoAtencao = {
    estado: amostra.estado,
    amostras: numero(atual?.amostras) + 1,
    duracaoMs: numero(atual?.duracaoMs) + duracao,
    falhas: numero(atual?.falhas) + numero(amostra.falhas),
    amostrasPorSubsistema: { ...(atual?.amostrasPorSubsistema ?? {}) },
    naoAmostradosPorSubsistema: { ...(atual?.naoAmostradosPorSubsistema ?? {}) },
    inferenciaTotalMs,
    inferenciaAmostras,
    picoMemoriaBytes:
      atual?.picoMemoriaBytes === undefined && amostra.picoMemoriaBytes === undefined
        ? undefined
        : Math.max(numero(atual?.picoMemoriaBytes), numero(amostra.picoMemoriaBytes)),
    mudancasCena: numero(atual?.mudancasCena) + numero(amostra.mudancasCena),
    quadrosCorrelatos: numero(atual?.quadrosCorrelatos) + numero(amostra.quadrosCorrelatos),
    bytesCorrelatos: numero(atual?.bytesCorrelatos) + numero(amostra.bytesCorrelatos),
    quadrosSemCobertura: numero(atual?.quadrosSemCobertura) + numero(amostra.quadrosSemCobertura),
  };

  for (const subsistema of SUBSISTEMAS) {
    const amostrado = amostra.amostras?.[subsistema];
    const pulado = amostra.naoAmostrados?.[subsistema];
    if (typeof amostrado === "number" && Number.isFinite(amostrado)) {
      proximo.amostrasPorSubsistema[subsistema] =
        numero(proximo.amostrasPorSubsistema[subsistema]) + amostrado;
    }
    if (typeof pulado === "number" && Number.isFinite(pulado)) {
      proximo.naoAmostradosPorSubsistema[subsistema] =
        numero(proximo.naoAmostradosPorSubsistema[subsistema]) + pulado;
    }
  }

  const inferenciaMediaMs: Partial<Record<SubsistemaPercepcao, number>> = {};
  for (const subsistema of SUBSISTEMAS) {
    const total = inferenciaTotalMs[subsistema];
    const contagem = inferenciaAmostras[subsistema];
    if (typeof total === "number" && typeof contagem === "number" && contagem > 0) {
      inferenciaMediaMs[subsistema] = total / contagem;
    }
  }
  if (Object.keys(inferenciaMediaMs).length > 0) proximo.inferenciaMediaMs = inferenciaMediaMs;
  if (proximo.duracaoMs > 0) proximo.fpsEfetivo = proximo.amostras / (proximo.duracaoMs / 1000);

  return {
    porEstado: { ...anterior.porEstado, [amostra.estado]: proximo },
    totalAmostras: numero(anterior.totalAmostras) + 1,
    totalDuracaoMs: numero(anterior.totalDuracaoMs) + duracao,
  };
}

/** Serialização compacta para telemetria/UI (não altera o contrato de dominio). */
export function custoParaRegistro(
  custo: CustoEstadoAtencao
): Record<string, unknown> {
  return {
    estado: custo.estado,
    amostras: custo.amostras,
    duracaoMs: custo.duracaoMs,
    falhas: custo.falhas,
    fpsEfetivo: custo.fpsEfetivo,
    amostrasPorSubsistema: custo.amostrasPorSubsistema,
    naoAmostradosPorSubsistema: custo.naoAmostradosPorSubsistema,
    inferenciaMediaMs: custo.inferenciaMediaMs,
    picoMemoriaBytes: custo.picoMemoriaBytes,
    mudancasCena: custo.mudancasCena,
    quadrosCorrelatos: custo.quadrosCorrelatos,
    bytesCorrelatos: custo.bytesCorrelatos,
    quadrosSemCobertura: custo.quadrosSemCobertura,
  };
}
