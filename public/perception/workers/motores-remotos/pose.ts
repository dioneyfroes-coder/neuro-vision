import { criarMotorPoseTransformers, MODELO_POSE_PADRAO } from "../../../pose";
import type { CriadorMotorPose, MotorPose, SaidaPoseCru } from "../../adapters/pose-estimator.adapter";
import { ClienteWorker, TEMPO_CARGA_WORKER_MS, TEMPO_INFERENCIA_WORKER_MS } from "../cliente-worker";
import type { InfoCargaWorker } from "../protocolo";
import { avisoFallback } from "./comum";

/** Cria o motor remoto de pose; o worker ja devolve o modelo carregado. */
export const criarMotorPoseRemoto: CriadorMotorPose = async (modelo, aoStatus) => {
  const idModelo = modelo || MODELO_POSE_PADRAO;
  let cliente: ClienteWorker | null = null;
  let local: MotorPose | null = null;
  const garantirLocal = async (): Promise<MotorPose> => {
    if (!local) local = await criarMotorPoseTransformers(idModelo, aoStatus);
    return local;
  };

  try {
    cliente = new ClienteWorker("pose");
    cliente.aoStatus = aoStatus;
    const info = await cliente.requisitar<InfoCargaWorker>(
      { tipo: "carregar", motor: "pose", modelo: idModelo },
      TEMPO_CARGA_WORKER_MS
    );
    const remoto = cliente;
    return {
      dispositivo: info.dispositivo ?? undefined,
      versao: info.versao,
      async executar(imagem: string): Promise<SaidaPoseCru> {
        try {
          return await remoto.requisitar<SaidaPoseCru>(
            { tipo: "executar", motor: "pose", imagem },
            TEMPO_INFERENCIA_WORKER_MS
          );
        } catch (erro) {
          remoto.encerrar();
          avisoFallback(aoStatus, "pose", erro);
          const motorLocal = await garantirLocal();
          return motorLocal.executar(imagem);
        }
      },
      async encerrar() {
        remoto.encerrar();
        await local?.encerrar?.();
        local = null;
      },
    };
  } catch (erro) {
    cliente?.encerrar();
    avisoFallback(aoStatus, "pose", erro);
    return garantirLocal();
  }
};
