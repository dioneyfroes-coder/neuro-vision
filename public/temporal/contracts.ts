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

/**
 * Nivel de leitura temporal (Etapa 9 do roteiro):
 *
 * - `basico`: apenas a logica pre-existente de frame unico — rastreamento de
 *   objetos (`rastreamento.ts`) e mudanca de cena (`cena.ts`) — emitida como
 *   eventos. Sem rastreadores de pose/maos nem maquinas de estado de gesto/braco.
 * - `ampliado`: acrescenta rastreamento de pose/maos com IDs estaveis,
 *   suavizacao, maquinas de estado de gesto/braco e eventos com duracao.
 *
 * A definicao de `basico` e explicita para que a variante C do benchmark nao
 * seja ambigua em relacao a `ampliado` (variante D).
 */
export type ModoMotorTemporal = "basico" | "ampliado";

export interface ConfigMotorTemporal {
  /** Nivel de leitura temporal: `basico` ou `ampliado`. */
  modo: ModoMotorTemporal;
  rastreador: ConfigRastreador;
  gestos: ConfigMaquinaSinais;
  braco: ConfigMaquinaSinais;
  /**
   * Maquina de estado do movimento corporal (deslocamento de pessoas rastreadas).
   * Separada de gestos/braco para que cada sinal tenha sua propria confirmacao.
   */
  movimento: ConfigMaquinaSinais;
  /** y (normalizado, topo = 0) a partir do qual um punho conta como erguido. */
  limiarAlturaBraco: number;
  /**
   * Histerese (normalizada) do braco: com o sinal ja ativo, o punho continua
   * contando como erguido enquanto `y <= limiarAlturaBraco + histereseBraco`,
   * evitando cintilacao quando o punho fica na regiao do limiar.
   */
  histereseBraco: number;
  /**
   * Confianca minima dos pontos articulares (ombro, cotovelo e punho) para que
   * a relacao articular do braco erguido seja avaliada. Pontos pouco confiaveis
   * nao sustentam a conclusao de "braco levantado".
   */
  confiancaMinimaPontoBraco: number;
  /**
   * Deslocamento normalizado minimo (por frame) do centro de uma pessoa
   * rastreada para contar como movimento corporal. Valores muito baixos
   * transformam ruido de pose em evento; altos perdem deslocamentos lentos.
   */
  limiarMovimentoCorporal: number;
  /**
   * Gap (ms) entre o fim do ciclo anterior e o inicio do atual que sinaliza um
   * periodo cego (janela sem observacao).
   */
  limiarPeriodoCegoMs: number;
}

export const CONFIG_MOTOR_TEMPORAL_PADRAO: ConfigMotorTemporal = {
  modo: "ampliado",
  rastreador: CONFIG_RASTREADOR_PADRAO,
  gestos: CONFIG_MAQUINA_PADRAO,
  braco: CONFIG_MAQUINA_PADRAO,
  movimento: { framesParaConfirmar: 2, framesParaEncerrar: 2, confiancaMinima: 0.5 },
  limiarAlturaBraco: 0.4,
  histereseBraco: 0.1,
  confiancaMinimaPontoBraco: 0.5,
  limiarMovimentoCorporal: 0.015,
  limiarPeriodoCegoMs: 1200,
};

/** Configuracao parcial aceita na construcao do motor. */
export type ConfiguracaoParcialMotorTemporal = Partial<
  Omit<ConfigMotorTemporal, "rastreador" | "gestos" | "braco" | "movimento">
> & {
  rastreador?: Partial<ConfigRastreador>;
  gestos?: Partial<ConfigMaquinaSinais>;
  braco?: Partial<ConfigMaquinaSinais>;
  movimento?: Partial<ConfigMaquinaSinais>;
};

/** Leitura consolidada + observacoes enriquecidas com os IDs de rastreamento. */
export interface ResultadoTemporal extends ResumoTemporal {
  /**
   * Copias das observacoes do ciclo com `entidadeId` preenchido em pessoas e
   * maos pelo rastreador. Sao essas copias que devem seguir para o contexto
   * serializado: os objetos originais (congelados) nao sao mutados.
   */
  observacoes: ObservacaoFrame[];
}

/** Porta do motor temporal: consome observacoes e emite resumo por ciclo. */
export interface MotorTemporal {
  processar(observacoes: ObservacaoFrame[]): ResultadoTemporal;
  /** Reseta todo o estado (sessao explicita). Nao usar entre ciclos normais. */
  resetar(): void;
}
