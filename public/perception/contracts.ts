import type {
  ResultadoDeteccaoLocal,
  ResultadoMaos,
  ResultadoNsfw,
  ResultadoOuIndisponivel,
  ResultadoPose,
} from "../../src/domain/perception";

/**
 * Portas dos adaptadores de percepcao (Etapa 3 do roteiro de modularizacao).
 *
 * O nucleo da aplicacao conhece **apenas** estes contratos — `DetectorObjetos`,
 * `EstimadorPose` e `ReconhecedorGestos` (principio 10) — e nao APIs de YOLO,
 * Transformers.js ou MediaPipe. Cada implementacao concreta vive em
 * `public/perception/adapters/*` e traduz a saida do SDK para os contratos
 * normalizados de `src/domain/perception.ts`:
 *
 * - coordenadas de caixa em **pixels** da imagem analisada (`Caixa`);
 * - pontos de mao/pose em coordenadas **normalizadas [0, 1]**;
 * - confianca em **[0, 1]**, quando o modelo a expoe;
 * - falha vira `ResultadoIndisponivel`, nunca lista vazia (principio 8).
 */

/**
 * Metricas de custo e telemetria de um adaptador, medidas individualmente
 * (Etapa 3.5; telemetria consolidada na Fase 2).
 *
 * `modelo`, `dispositivo`, `versao` e `status` descrevem **o que** esta rodando;
 * `tempoCargaMs`/`tempoInferenciaMs`/`memoriaBytes` descrevem **o custo**;
 * `motivoFalha` explica a indisponibilidade quando `status === "indisponivel"`.
 */
export interface MetricasAdaptador {
  /** Identificador do modelo atualmente carregado (ex.: `Xenova/yolov8n-pose`). */
  modelo?: string;
  /** Dispositivo de inferencia efetivamente usado (ex.: `wasm`, `webgpu`, `gpu`, `cpu`). */
  dispositivo?: string;
  /** Versao do runtime/modelo, quando exposta pelo SDK. */
  versao?: string;
  /** Estado do subsistema na ultima operacao. */
  status?: EstadoSubsistema;
  /** Motivo legivel quando `status === "indisponivel"`. */
  motivoFalha?: string;
  /** Tempo da ultima carga do modelo (ms). */
  tempoCargaMs?: number;
  /** Tempo da ultima inferencia (ms). */
  tempoInferenciaMs?: number;
  /** Memoria usada pelo subsistema (bytes), quando o ambiente a expoe. */
  memoriaBytes?: number;
}

/**
 * Estado de um subsistema de percepcao, distinguindo **falha** de **ausencia**
 * (principio 8):
 * - `ok`: rodou e devolveu resultado (inclusive lista vazia valida);
 * - `sem_resultado`: rodou corretamente e nao encontrou nada;
 * - `indisponivel`: nao rodou (desativado, falha de carga ou inferencia);
 * - `nao_carregado`: nunca foi carregado nesta sessao.
 *
 * Reusa o tipo do dominio (`src/domain/perception.ts`) para que a telemetria do
 * adaptador e o contexto multimodal falem do mesmo estado.
 */
export type EstadoSubsistema = import("../../src/domain/perception").EstadoSubsistema;

/** Dimensoes, em pixels, da imagem analisada. */
export interface Dimensoes {
  largura: number;
  altura: number;
}

/** Entrada comum a qualquer adaptador: um frame identificado. */
export interface EntradaAdaptador {
  /** Frame como data URL ou base64 (o adaptador decide o formato aceito). */
  imagem: string;
  /** Dimensoes da imagem, para normalizar caixas/coordenadas. */
  dimensoes?: Dimensoes;
}

/** Opcoes de deteccao de objetos (limiar de confianca e escala). */
export interface OpcoesDeteccao {
  /** Limiar minimo de confianca em [0, 1]. */
  threshold?: number;
  /** Quando `true`, as caixas vem em fracoes [0, 1] em vez de pixels. */
  percentage?: boolean;
}

/** Porta do detector de objetos: independente do SDK (Transformers.js/YOLO). */
export interface DetectorObjetos {
  /** Identificador do adaptador (ex.: `objetos`). */
  readonly id: string;
  /** Modelo atualmente carregado, ou `null`. */
  readonly modelo: string | null;
  /** Metricas de carga/inferencia/memoria do adaptador. */
  readonly metricas: MetricasAdaptador;
  /** Aviso de status (ex.: fallback de dispositivo). Opcional. */
  aoStatus?: (mensagem: string) => void;
  /** Carrega o modelo; reutiliza o cache quando ja carregado. */
  carregar(modelo: string, aoStatus?: (mensagem: string) => void): Promise<void>;
  /** Detecta objetos num frame e devolve o resultado normalizado. */
  detectar(entrada: EntradaAdaptador, opcoes?: OpcoesDeteccao): Promise<ResultadoDeteccaoLocal>;
  /** Libera recursos do adaptador. */
  encerrar(): void;
}

/** Porta do estimador de pose (contrato; adaptador entra na Etapa 5). */
export interface EstimadorPose {
  readonly id: string;
  readonly modelo: string | null;
  readonly metricas: MetricasAdaptador;
  aoStatus?: (mensagem: string) => void;
  carregar(modelo: string, aoStatus?: (mensagem: string) => void): Promise<void>;
  /** Estima poses humanas num frame; falha vira `ResultadoIndisponivel`. */
  estimar(entrada: EntradaAdaptador): Promise<ResultadoOuIndisponivel<ResultadoPose>>;
  encerrar(): void;
}

/** Porta do reconhecedor de maos/gestos (contrato; adaptador entra na Etapa 5). */
export interface ReconhecedorGestos {
  readonly id: string;
  readonly modelo: string | null;
  readonly metricas: MetricasAdaptador;
  aoStatus?: (mensagem: string) => void;
  carregar(modelo: string, aoStatus?: (mensagem: string) => void): Promise<void>;
  /** Reconhece maos/gestos num frame; falha vira `ResultadoIndisponivel`. */
  reconhecer(entrada: EntradaAdaptador): Promise<ResultadoOuIndisponivel<ResultadoMaos>>;
  encerrar(): void;
}

/**
 * Porta do classificador **NSFW experimental** (desligado por padrao).
 *
 * `modelo` e `null` ate um `carregar` bem-sucedido: e o sinal que o pipeline
 * usa para saber se o subsistema esta ativo neste sessao (o toggle da
 * interface decide se o modelo e carregado na configuracao).
 */
export interface ClassificadorNsfw {
  readonly id: string;
  readonly modelo: string | null;
  readonly metricas: MetricasAdaptador;
  aoStatus?: (mensagem: string) => void;
  carregar(modelo: string, aoStatus?: (mensagem: string) => void): Promise<void>;
  /** Classifica regioes sensiveis num frame; falha vira `ResultadoIndisponivel`. */
  avaliar(entrada: EntradaAdaptador, opcoes?: OpcoesDeteccao): Promise<ResultadoNsfw>;
  encerrar(): void;
}

/**
 * Amostra a memoria de heap usada pelo subsistema, quando o ambiente a expoe
 * (Chrome). Em outros navegadores/Node retorna `undefined`, e as metricas
 * simplesmente omitem o campo.
 */
export function amostrarMemoriaBytes(): number | undefined {
  const memoria = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory;
  return typeof memoria?.usedJSHeapSize === "number" ? memoria.usedJSHeapSize : undefined;
}

/**
 * Utilitario compartilhado pelos adaptadores: mede a inferencia e atualiza as
 * metricas de tempo/memoria (Etapa 3.5). Os adaptadores de pose e maos reusam a
 * mesma definicao quando forem implementados (Etapa 5).
 */
export function medirTempoInferencia<T>(
  metricas: MetricasAdaptador,
  executar: () => Promise<T>
): Promise<T> {
  const inicio = performance.now();
  return executar().finally(() => {
    metricas.tempoInferenciaMs = Math.round(performance.now() - inicio);
    metricas.memoriaBytes = amostrarMemoriaBytes() ?? metricas.memoriaBytes;
  });
}
