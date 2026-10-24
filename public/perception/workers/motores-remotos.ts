import type { DeteccaoYOLO, MotorDeteccao, OpcoesInferenciaYolo } from "../../yolo-onnx";
import { DetectorYoloOnnx } from "../../yolo-onnx";
import { DetectorNsfwOnnx } from "../../nsfw-onnx";
import { criarMotorPoseTransformers, MODELO_POSE_PADRAO } from "../../pose";
import { criarMotorGestosMediaPipe, MODELO_MAOS_PADRAO } from "../../gestos";
import type {
  CriadorMotorPose,
  MotorPose,
  SaidaPoseCru,
} from "../adapters/pose-estimator.adapter";
import type {
  CriadorMotorMaos,
  MotorMaos,
  SaidaMaosCru,
} from "../adapters/hand-gesture.adapter";
import {
  ClienteWorker,
  ErroWorker,
  TEMPO_CARGA_WORKER_MS,
  TEMPO_INFERENCIA_WORKER_MS,
} from "./cliente-worker";
import type { InfoCargaWorker, MotorWorker } from "./protocolo";

/**
 * Motores "worker-first" usados na composicao do pipeline multiframe.
 *
 * A inferencia roda em um `Worker` dedicado (fora da thread principal). Quando o
 * worker nao consegue iniciar/carregar/executar - navegador sem module worker,
 * timeout, MediaPipe sem contexto no worker - o motor cai de forma transparente
 * para a implementacao local equivalente (`DetectorYoloOnnx`,
 * `criarMotorPoseTransformers`, `criarMotorGestosMediaPipe`). O fallback e
 * decidido **uma vez por motor**: depois de cair para o local, as proximas
 * chamadas nao tentam o worker de novo (evita latencia repetida).
 *
 * O contrato observado pelos adaptadores nao muda: eles continuam recebendo
 * `MotorDeteccao`/`MotorPose`/`MotorMaos` e nao sabem onde a inferencia rodou.
 */

function mensagemDe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function normalizarDispositivo(valor: string | null | undefined): "webgpu" | "wasm" | null {
  if (valor === "webgpu" || valor === "wasm") return valor;
  return null;
}

function avisoFallback(
  aoStatus: ((mensagem: string) => void) | undefined,
  motor: string,
  erro: unknown
): void {
  const detalhe = mensagemDe(erro);
  const origem = erro instanceof ErroWorker ? "worker" : "motor";
  aoStatus?.(`${origem} de ${motor} indisponivel (${detalhe}); usando a thread principal.`);
}

/**
 * Motor de deteccao (COCO ou NSFW) com worker dedicado e fallback local.
 * Cada instancia cria seu proprio worker - COCO e NSFW nao compartilham fila.
 */
function criarMotorDeteccaoComWorker(
  nome: MotorWorker,
  criarLocal: () => MotorDeteccao
): MotorDeteccao {
  let cliente: ClienteWorker | null = null;
  let local: MotorDeteccao | null = null;
  let modelo: string | null = null;
  let dispositivo: "webgpu" | "wasm" | null = null;
  let tempoCargaMs: number | null = null;
  let status: ((mensagem: string) => void) | undefined;

  const garantirLocal = async (): Promise<MotorDeteccao> => {
    if (!local) {
      local = criarLocal();
      local.aoStatus = status;
      await local.carregar(modelo ?? "", status);
    }
    dispositivo = local.dispositivo;
    tempoCargaMs = local.tempoCargaMs;
    modelo = local.modelo;
    return local;
  };

  return {
    get modelo() {
      return modelo;
    },
    get dispositivo() {
      return dispositivo;
    },
    get tempoCargaMs() {
      return tempoCargaMs;
    },
    get aoStatus() {
      return status;
    },
    set aoStatus(fn) {
      status = fn;
      if (local) local.aoStatus = fn;
      if (cliente) cliente.aoStatus = fn;
    },

    async carregar(idModelo, aoStatus) {
      status = aoStatus ?? status;
      modelo = idModelo;
      try {
        cliente = new ClienteWorker(nome);
        cliente.aoStatus = status;
        const info = await cliente.requisitar<InfoCargaWorker>(
          { tipo: "carregar", motor: nome, modelo: idModelo ?? "" },
          TEMPO_CARGA_WORKER_MS
        );
        dispositivo = normalizarDispositivo(info.dispositivo);
        tempoCargaMs = info.tempoCargaMs;
        modelo = info.modelo;
        return;
      } catch (erro) {
        cliente?.encerrar();
        cliente = null;
        avisoFallback(status, nome, erro);
      }
      await garantirLocal();
    },

    async executar(imagem: string, opcoes?: OpcoesInferenciaYolo): Promise<DeteccaoYOLO[]> {
      if (cliente?.ativo) {
        try {
          return await cliente.requisitar<DeteccaoYOLO[]>(
            {
              tipo: "executar",
              motor: nome,
              imagem,
              threshold: opcoes?.threshold,
              percentage: opcoes?.percentage,
            },
            TEMPO_INFERENCIA_WORKER_MS
          );
        } catch (erro) {
          cliente.encerrar();
          cliente = null;
          avisoFallback(status, nome, erro);
        }
      }
      return (await garantirLocal()).executar(imagem, opcoes);
    },

    encerrar() {
      cliente?.encerrar();
      cliente = null;
      local?.encerrar?.();
      local = null;
      modelo = null;
      dispositivo = null;
      tempoCargaMs = null;
    },
  };
}

/** Deteccao COCO em worker dedicado (fallback: YOLO local). */
export function criarMotorDeteccaoRemoto(): MotorDeteccao {
  return criarMotorDeteccaoComWorker("deteccao", () => new DetectorYoloOnnx());
}

/** Classificador NSFW em worker dedicado (fallback: NSFW local). */
export function criarMotorNsfwRemoto(): MotorDeteccao {
  return criarMotorDeteccaoComWorker("nsfw", () => new DetectorNsfwOnnx());
}

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
      encerrar() {
        remoto.encerrar();
        local?.encerrar?.();
        local = null;
      },
    };
  } catch (erro) {
    cliente?.encerrar();
    avisoFallback(aoStatus, "pose", erro);
    return garantirLocal();
  }
};

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
