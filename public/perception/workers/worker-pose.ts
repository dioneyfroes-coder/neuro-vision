import { criarMotorPoseTransformers, MODELO_POSE_PADRAO } from "../../pose";
import type { MotorPose } from "../adapters/pose-estimator.adapter";
import { atenderWorker, type MotorAtendido } from "./atender";

/**
 * Worker dedicado do estimador de pose (Transformers.js + YOLO Pose).
 *
 * O modelo e carregado sob demanda dentro do worker; a thread principal nunca
 * toca no runtime. A saida crua (keypoints em pixels) atravessa o RPC e a
 * normalizacao para [0, 1] continua no adaptador.
 */

let motor: MotorPose | null = null;
let modeloAtual: string | null = null;
let dispositivo: string | null = null;

const pose: MotorAtendido = {
  get modelo() {
    return modeloAtual;
  },
  get dispositivo() {
    return dispositivo;
  },
  versao: "3.8.1",
  async carregar(idModelo, aoStatus) {
    modeloAtual = idModelo || MODELO_POSE_PADRAO;
    motor = await criarMotorPoseTransformers(modeloAtual, aoStatus);
    dispositivo = motor.dispositivo ?? null;
  },
  async executar(imagem) {
    if (!motor) throw new Error("motor de pose nao carregado neste worker");
    return motor.executar(imagem);
  },
  encerrar() {
    motor?.encerrar?.();
    motor = null;
    modeloAtual = null;
    dispositivo = null;
  },
};

atenderWorker({ pose });
