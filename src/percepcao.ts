import type { EntradaLog, MotivoAnalise, ObjetoVisto } from "./types";

/** Metadados de confianca/comportamento de um resultado de inferencia. */
export interface MetadadosConfianca {
  /** Tokens gerados pelo modelo, quando aplicavel. */
  tokens?: number;
  /** Papel no roteiro: primeiro frame ou delta. */
  papel?: "base" | "delta";
  /** O motor sinalizou que nada mudou desde a ultima observacao. */
  semMudanca?: boolean;
}

/**
 * Resultado padronizado de uma inferencia, independente do motor. O modulo de
 * memoria consome apenas este formato.
 */
export interface ResultadoPercepcao {
  /** Modelo/motor que produziu o resultado. */
  modelo: string;
  /** Duracao da inferencia em milissegundos. */
  duracaoMs: number;
  /** Objetos detectados (vazio para motores que so descrevem). */
  objetos: ObjetoVisto[];
  /** Descricao textual opcional (descricao/roteiro). */
  descricao?: string;
  /** Snapshot associado, quando houver. */
  snapshot?: string;
  /** Metadados de confianca. */
  confianca?: MetadadosConfianca;
}

/** Entrada generica de um motor: o frame e seus dados auxiliares. */
export interface EntradaPercepcao {
  /** Frame como data URL ou base64, conforme o motor. */
  imagem: string;
  /** Snapshot opcional (data URL) para persistencia. */
  snapshot?: string;
}

/** Motor de percepcao com ciclo de vida explicito. */
export interface MotorPercepcao {
  /** Identificador do motor (ex.: "deteccao", "ollama", "roteiro"). */
  readonly id: string;
  /** Garante que recursos externos estejam prontos. */
  inicializar(aoStatus?: (mensagem: string) => void): Promise<void>;
  /** Executa uma analise sobre a entrada; retorna null quando nao ha resultado. */
  analisar(
    entrada: EntradaPercepcao,
    sinal: AbortSignal,
    aoProgresso?: (parcial: string) => void
  ): Promise<ResultadoPercepcao | null>;
  /** Libera recursos do motor. */
  encerrar(): void;
}

/**
 * Converte um resultado padronizado em entrada de historico. O modulo de memoria
 * depende apenas de `ResultadoPercepcao` — nao das APIs do Transformers.js nem
 * do Ollama — de modo que trocar de motor nao exige reescrever o historico.
 */
export function entradaDeResultado(
  resultado: ResultadoPercepcao,
  tipo: EntradaLog["tipo"],
  timestamp = new Date().toISOString(),
  motivo?: MotivoAnalise | null
): EntradaLog {
  const papel = resultado.confianca?.papel;
  return {
    timestamp,
    modelo: resultado.modelo,
    objetos: resultado.objetos,
    resumo: resultado.descricao ?? "",
    tipo,
    papel: tipo === "roteiro" ? (papel ?? "delta") : undefined,
    snapshot: resultado.snapshot,
    ms: resultado.duracaoMs,
    tokens: resultado.confianca?.tokens,
    motivo: motivo ?? undefined,
  };
}
