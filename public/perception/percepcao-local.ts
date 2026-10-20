import { AdaptadorDetectorObjetos } from "./adapters/object-detector.adapter";
import { AdaptadorPose } from "./adapters/pose-estimator.adapter";
import { AdaptadorMaos } from "./adapters/hand-gesture.adapter";
import { criarMotorPoseTransformers, MODELO_POSE_PADRAO } from "../pose";
import { criarMotorGestosMediaPipe, MODELO_MAOS_PADRAO } from "../gestos";
import { MODELO_YOLO_PADRAO } from "../yolo-onnx";
import { PipelineLocal, configurarSubsistemas, criarProcessadorFrameLocal } from "./local-perception-pipeline";
import type { DetectorObjetos } from "./contracts";
import type {
  ConfiguracaoParcial,
  DependenciasPipelineLocal,
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
  /** Detector de objetos ja existente (reutiliza o modelo carregado no app). */
  detector?: DetectorObjetos;
  /** Ids de modelo a carregar; utiliza MODELOS_PERCEPCAO_PADRAO quando ausente. */
  modelos?: ModelosPercepcao;
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
  /** Porta injetada no pipeline (somente para uso interno/diagnostico). */
  dependencias: DependenciasPipelineLocal;
  /** Processador de frame pronto para o ciclo multiframe. */
  processarFrame: ProcessarFrameLocal;
  /** Carrega os modelos de forma isolada; aceita override de modelos. */
  configurar(
    aoStatus?: (mensagem: string) => void,
    modelos?: ModelosPercepcao
  ): Promise<ConfiguracaoParcial>;
  /** Encerra os tres subsistemas. */
  encerrar(): void;
}

/** Modelos padrao para a primeira configuracao de referencia (Etapa 5). */
export const MODELOS_PERCEPCAO_PADRAO: Required<ModelosPercepcao> = {
  objetos: MODELO_YOLO_PADRAO,
  pose: MODELO_POSE_PADRAO,
  maos: MODELO_MAOS_PADRAO,
};

export function criarPercepcaoLocal(opcoes: OpcoesPercepcaoLocal = {}): PercepcaoLocal {
  const detector = opcoes.detector ?? new AdaptadorDetectorObjetos();
  const pose = new AdaptadorPose(criarMotorPoseTransformers);
  const maos = new AdaptadorMaos(criarMotorGestosMediaPipe);

  const dependencias: DependenciasPipelineLocal = {
    detector,
    pose,
    maos,
    obterThreshold: opcoes.obterThreshold,
    aoStatus: opcoes.aoStatus,
  };

  const pipeline = new PipelineLocal(dependencias);
  const modelos = { ...MODELOS_PERCEPCAO_PADRAO, ...opcoes.modelos };

  return {
    detector,
    pose,
    maos,
    dependencias,
    processarFrame: criarProcessadorFrameLocal(dependencias),
    configurar: (aoStatus?: (mensagem: string) => void, override?: ModelosPercepcao) =>
      configurarSubsistemas(dependencias, { ...modelos, ...override }, aoStatus),
    encerrar: () => pipeline.encerrar(),
  };
}
