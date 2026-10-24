import { AdaptadorDetectorObjetos } from "./adapters/object-detector.adapter";
import { AdaptadorPose } from "./adapters/pose-estimator.adapter";
import { AdaptadorMaos } from "./adapters/hand-gesture.adapter";
import { AdaptadorClassificadorNsfw } from "./adapters/nsfw-classifier.adapter";
import { criarMotorPoseTransformers, MODELO_POSE_PADRAO } from "../pose";
import { criarMotorGestosMediaPipe, MODELO_MAOS_PADRAO } from "../gestos";
import { MODELO_YOLO_PADRAO } from "../yolo-onnx";
import {
  criarMotorDeteccaoRemoto,
  criarMotorMaosRemoto,
  criarMotorNsfwRemoto,
  criarMotorPoseRemoto,
} from "./workers/motores-remotos";
import { PipelineLocal, configurarSubsistemas, criarProcessadorFrameLocal, HABILITACAO_PADRAO } from "./local-perception-pipeline";
import type { DetectorObjetos } from "./contracts";
import type {
  ConfiguracaoParcial,
  DependenciasPipelineLocal,
  HabilitacaoSubsistemas,
  ModelosPercepcao,
  ProcessarFrameLocal,
} from "./local-perception-pipeline";

/**
 * Composicao concreta do pipeline local de percepcao (Etapa 5).
 *
 * Cria os tres adaptadores com os motores de SDK padrao (Transformers.js para
 * pose, MediaPipe para maos) e o adaptador do detector ja existente. O
 * carregamento dos modelos e coordenado por `configurar()` de forma isolada:
 * falha de um subsistema nao impede os outros.
 *
 * Esta composicao ainda **nao** e ligada a UI. Ela existe para que Etapas 6–7
 * possam habilitar o ciclo multiframe com os tres componentes, usando os mesmos
 * contratos.
 */

export interface OpcoesPercepcaoLocal {
  /** Detector de objetos ja existente (sobrescreve o detector em worker). */
  detector?: DetectorObjetos;
  /**
   * Usa workers dedicados por subsistema (padrao `true`). Com `false` os
   * motores rodam na thread principal - util para diagnostico/comparacao e como
   * alvo de fallback quando o ambiente nao suporta module workers.
   */
  usarWorkers?: boolean;
  /** Ids de modelo a carregar; utiliza MODELOS_PERCEPCAO_PADRAO quando ausente. */
  modelos?: ModelosPercepcao;
  /** Habilitacao explicita por subsistema; default `HABILITACAO_PADRAO`. */
  habilitacao?: HabilitacaoSubsistemas;
  /** Limiar de deteccao lido a cada frame. */
  obterThreshold?: () => number;
  /** Status/avisos (ex.: progresso de carregamento e falhas). */
  aoStatus?: (mensagem: string) => void;
}

export interface PercepcaoLocal {
  /** Detector de objetos (o injetado ou um adaptador proprio). */
  detector: DetectorObjetos;
  /** Adaptador do estimador de pose (YOLO Pose). */
  pose: AdaptadorPose;
  /** Adaptador do reconhecedor de maos/gestos (MediaPipe). */
  maos: AdaptadorMaos;
  /** Adaptador do classificador NSFW experimental (carrega so com toggle). */
  nsfw: AdaptadorClassificadorNsfw;
  /** Porta injetada no pipeline (somente para uso interno/diagnostico). */
  dependencias: DependenciasPipelineLocal;
  /** Habilitacao efetiva por subsistema nesta sessao. */
  habilitacao: Required<HabilitacaoSubsistemas>;
  /** Processador de frame pronto para o ciclo multiframe. */
  processarFrame: ProcessarFrameLocal;
  /**
   * Carrega os modelos de forma isolada; aceita override de modelos. A
   * habilitacao efetiva (do construtor) sempre prevalece sobre modelos presentes.
   */
  configurar(
    aoStatus?: (mensagem: string) => void,
    modelos?: ModelosPercepcao
  ): Promise<ConfiguracaoParcial>;
  /** Encerra os subsistemas. */
  encerrar(): void;
}

/**
 * Modelos padrao da configuracao de referencia (Etapa 5). O NSFW experimental
 * **nao** tem modelo padrao: carrega apenas quando o toggle da interface
 * coloca um valor em `modelos.nsfw`.
 */
export const MODELOS_PERCEPCAO_PADRAO: ModelosPercepcao = {
  objetos: MODELO_YOLO_PADRAO,
  pose: MODELO_POSE_PADRAO,
  maos: MODELO_MAOS_PADRAO,
};

export function criarPercepcaoLocal(opcoes: OpcoesPercepcaoLocal = {}): PercepcaoLocal {
  // Workers dedicados por padrao: a inferencia sai da thread principal e roda em
  // paralelo de verdade (deteccao/pose/maos em nucleos distintos). Cada motor
  // remoto cai para a implementacao local se o worker nao puder ser usado.
  const usarWorkers = opcoes.usarWorkers ?? true;
  const detector =
    opcoes.detector ??
    new AdaptadorDetectorObjetos(usarWorkers ? criarMotorDeteccaoRemoto() : undefined);
  const pose = new AdaptadorPose(usarWorkers ? criarMotorPoseRemoto : criarMotorPoseTransformers);
  const maos = new AdaptadorMaos(usarWorkers ? criarMotorMaosRemoto : criarMotorGestosMediaPipe);
  const nsfw = new AdaptadorClassificadorNsfw(
    usarWorkers ? criarMotorNsfwRemoto() : undefined
  );

  const habilitacao: Required<HabilitacaoSubsistemas> = {
    ...HABILITACAO_PADRAO,
    ...opcoes.habilitacao,
  };

  const dependencias: DependenciasPipelineLocal = {
    detector,
    pose,
    maos,
    nsfw,
    habilitacao,
    obterThreshold: opcoes.obterThreshold,
    aoStatus: opcoes.aoStatus,
  };

  const pipeline = new PipelineLocal(dependencias);
  const modelos = { ...MODELOS_PERCEPCAO_PADRAO, ...opcoes.modelos };

  return {
    detector,
    pose,
    maos,
    nsfw,
    dependencias,
    habilitacao,
    processarFrame: criarProcessadorFrameLocal(dependencias),
    configurar: (aoStatus?: (mensagem: string) => void, override?: ModelosPercepcao) =>
      configurarSubsistemas(dependencias, { ...modelos, ...override }, aoStatus, habilitacao),
    encerrar: () => pipeline.encerrar(),
  };
}
