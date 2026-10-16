import type { ObservacaoFrame, ResumoTemporal } from "../../src/domain";

/**
 * Contratos do motor temporal (Etapa 6 do roteiro de modularizacao).
 *
 * O motor consome `ObservacaoFrame[]` (a sequencia de frames de um ciclo) e
 * produz `ResumoTemporal` com eventos de identidade unica, mantendo estado
 * entre ciclos. Nenhum tipo aqui importa API de SDK de modelo — a regra e
 * imposta pelo eslint apenas em `src/domain/**`, mas aqui mantemos o motor
 * puro e testavel sem dependencias de browser.
 */

/** Configuracao do rastreador generico de entidades (pose/maos/objetos). */
export interface ConfigRastreador {
  /** Distancia maxima (coordenadas normalizadas) para associar a mesma entidade. */
  distanciaMaxima: number;
  /** Frames consecutivos ausentes antes de descartar a entidade. */
  maxFramesAusente: number;
  /** Fator de suavizacao exponencial (0 = sem memoria, 1 = nunca atualiza). */
  alphaSuavizacao: number;
}

export const CONFIG_RASTREADOR_PADRAO: ConfigRastreador = {
  distanciaMaxima: 0.25,
  maxFramesAusente: 5,
  alphaSuavizacao: 0.6,
};

/** Configuracao das maquinas de estado (gestos e braco levantado). */
export interface ConfigMaquinaSinais {
  /** Frames consecutivos do sinal antes de confirmar o evento. */
  framesParaConfirmar: number;
  /** Frames sem o sinal antes de encerrar o evento confirmado. */
  framesParaEncerrar: number;
  /** Confianca minima do sinal para entrar na maquina. */
  confiancaMinima: number;
}

export const CONFIG_MAQUINA_PADRAO: ConfigMaquinaSinais = {
  framesParaConfirmar: 3,
  framesParaEncerrar: 3,
  confiancaMinima: 0.5,
};

export interface ConfigMotorTemporal {
  rastreador: ConfigRastreador;
  gestos: ConfigMaquinaSinais;
  braco: ConfigMaquinaSinais;
  /** y (normalizado, topo = 0) a partir do qual um punho conta como erguido. */
  limiarAlturaBraco: number;
  /**
   * Gap (ms) entre o fim do ciclo anterior e o inicio do atual que sinaliza um
   * periodo cego (janela sem observacao).
   */
  limiarPeriodoCegoMs: number;
}

export const CONFIG_MOTOR_TEMPORAL_PADRAO: ConfigMotorTemporal = {
  rastreador: CONFIG_RASTREADOR_PADRAO,
  gestos: CONFIG_MAQUINA_PADRAO,
  braco: CONFIG_MAQUINA_PADRAO,
  limiarAlturaBraco: 0.4,
  limiarPeriodoCegoMs: 1200,
};

/** Configuracao parcial aceita na construcao do motor. */
export type ConfiguracaoParcialMotorTemporal = Partial<
  Omit<ConfigMotorTemporal, "rastreador" | "gestos" | "braco">
> & {
  rastreador?: Partial<ConfigRastreador>;
  gestos?: Partial<ConfigMaquinaSinais>;
  braco?: Partial<ConfigMaquinaSinais>;
};

/** Porta do motor temporal: consome observacoes e emite resumo por ciclo. */
export interface MotorTemporal {
  processar(observacoes: ObservacaoFrame[]): ResumoTemporal;
  /** Reseta todo o estado (sessao explicita). Nao usar entre ciclos normais. */
  resetar(): void;
}
