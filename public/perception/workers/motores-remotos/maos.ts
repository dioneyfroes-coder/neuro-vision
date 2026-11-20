import { criarMotorGestosMediaPipe, MODELO_MAOS_PADRAO } from "../../../gestos";
import type { CriadorMotorMaos, MotorMaos, SaidaMaosCru } from "../../adapters/hand-gesture.adapter";
import { ClienteWorker, TEMPO_CARGA_WORKER_MS, TEMPO_INFERENCIA_WORKER_MS } from "../cliente-worker";
import type { InfoCargaWorker } from "../protocolo";
import { avisoFallback } from "./comum";

/** Cria o motor remoto de maos/gestos; o worker ja devolve o modelo carregado. */
export const criarMotorMaosRemoto: CriadorMotorMaos = async (modelo, aoStatus) => {
  const idModelo = modelo || MODELO_MAOS_PADRAO;
  let cliente: ClienteWorker | null = null;
  let local: MotorMaos | null = null;
  const garantirLocal = async (): Promise<MotorMaos> => {
    if (!local) local = await criarMotorGestosMediaPipe(idModelo, aoStatus);
    return local;
  };

  try {
    cliente = new ClienteWorker("maos");
    cliente.aoStatus = aoStatus;
    const info = await cliente.requisitar<InfoCargaWorker>(
      { tipo: "carregar", motor: "maos", modelo: idModelo },
      TEMPO_CARGA_WORKER_MS
    );
    const remoto = cliente;
    return {
      dispositivo: info.dispositivo ?? undefined,
      versao: info.versao,
      async executar(imagem: string): Promise<SaidaMaosCru> {
        try {
          return await remoto.requisitar<SaidaMaosCru>(
            { tipo: "executar", motor: "maos", imagem },
            TEMPO_INFERENCIA_WORKER_MS
          );
        } catch (erro) {
          remoto.encerrar();
          avisoFallback(aoStatus, "maos", erro);
          const motorLocal = await garantirLocal();
          return motorLocal.executar(imagem);
        }
      },
      encerrar() {
        remoto.encerrar();
        local?.encerrar?.();
        local = null;
      },
    };
  } catch (erro) {
    cliente?.encerrar();
    avisoFallback(aoStatus, "maos", erro);
    return garantirLocal();
  }
};
