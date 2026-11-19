import type { AmostragemFrame } from "../../../src/domain/cadencia";
import type { SnapshotCapturado } from "../../capture/snapshot-store";
import type { ProcessamentoFrame, TelemetriaSubsistema } from "../../cycle/ciclo-multiframe";
import type {
  ClassificadorNsfw,
  DetectorObjetos,
  EstimadorPose,
  ReconhecedorGestos,
} from "../contracts";

/** Subsistemas de percepcao local (disparados em paralelo por frame). */
export type SubsistemaPercepcao = "deteccao" | "pose" | "maos" | "nsfw";

export interface DependenciasPipelineLocal {
  /** Detector de objetos. Omitido: o subsistema fica indisponivel (desativado). */
  detector?: DetectorObjetos;
  /** Estimador de pose. Omitido: o subsistema fica indisponivel (desativado). */
  pose?: EstimadorPose;
  /** Reconhecedor de maos/gestos. Omitido: fica indisponivel (desativado). */
  maos?: ReconhecedorGestos;
  /**
   * Classificador **NSFW experimental**. O subsistema so roda quando o adaptador
   * esta presente **e** carregado (`modelo !== null`): sem toggle da interface
   * nenhum modelo e carregado e o campo `nsfw` simplesmente fica ausente no
   * frame — "nao rodou" permanece distinguivel de "rodou e nao marcou nada".
   */
  nsfw?: ClassificadorNsfw;
  /**
   * Habilitacao explicita por subsistema (Fase 2, item 1). Um subsistema
   * desabilitado responde `indisponivel` ("desativado") sem sequer tocar o SDK,
   * independentemente de a porta estar presente. Default: `HABILITACAO_PADRAO`.
   */
  habilitacao?: HabilitacaoSubsistemas;
  /** Limiar de deteccao lido a cada frame (reflete ajustes da interface). */
  obterThreshold?: () => number;
  /** Avisos do pipeline (ex.: subsistema que falhou). */
  aoStatus?: (mensagem: string) => void;
}

/**
 * Assinatura do processamento de um frame, compativel com
 * `DependenciasCicloMultiframe`. `amostragem` lista os subsistemas que a
 * cadencia quer executar neste frame; ausente = todos.
 */
export type ProcessarFrameLocal = (
  snapshot: SnapshotCapturado,
  sinal?: AbortSignal,
  amostragem?: AmostragemFrame
) => Promise<ProcessamentoFrame>;

/** Ids de modelo por subsistema (todos opcionais; `nsfw` so carrega com toggle). */
export interface ModelosPercepcao {
  objetos?: string;
  pose?: string;
  maos?: string;
  nsfw?: string;
}

/**
 * Habilitacao **explicita** de cada subsistema (Fase 2, item 1).
 *
 * Antes a ativacao era implicita: bastava haver um id de modelo para o
 * subsistema ser carregado, o que tornava impossivel distinguir "desligado de
 * proposito" de "esquecido". Aqui cada subsistema tem um booleano proprio; o
 * default vive em `HABILITACAO_PADRAO` e a interface pode sobrescrever por
 * sessao. Um subsistema desabilitado nunca chama `carregar` e responde
 * `indisponivel` (motivo "desativado") em cada frame — nunca lista vazia.
 */
export interface HabilitacaoSubsistemas {
  /** Deteccao de objetos (YOLO). */
  deteccao?: boolean;
  /** Estimativa de pose (YOLO Pose). */
  pose?: boolean;
  /** Maos/gestos (MediaPipe). */
  maos?: boolean;
  /** Classificador NSFW experimental (opt-in, desligado por padrao). */
  nsfw?: boolean;
}

/** Habilitacao de referencia: objetos/pose/maos ligados; NSFW opt-in. */
export const HABILITACAO_PADRAO: Required<HabilitacaoSubsistemas> = {
  deteccao: true,
  pose: true,
  maos: true,
  nsfw: false,
};

/** Resultado da configuracao dos subsistemas: quem carregou, quem falhou e quem esta desativado. */
export interface ConfiguracaoParcial {
  carregados: SubsistemaPercepcao[];
  falhas: { subsistema: SubsistemaPercepcao; motivo: string }[];
  /** Subsistemas desativados explicitamente (nunca tentaram carregar). */
  desativados: SubsistemaPercepcao[];
  /** Status final por subsistema, para telemetria/diagnostico. */
  status: Record<SubsistemaPercepcao, "carregado" | "desativado" | "falhou">;
  /**
   * Telemetria da **carga fria** de cada subsistema que tentou carregar
   * (`tempoCargaMs`, modelo, dispositivo, versao). Fica fora do custo por
   * snapshot para nao misturar inicializacao com regime aquecido.
   */
  carregamento?: Partial<Record<SubsistemaPercepcao, TelemetriaSubsistema>>;
}
