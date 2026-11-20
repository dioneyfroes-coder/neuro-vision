import type { DeteccaoYOLO, MotorDeteccao, OpcoesInferenciaYolo } from "../../../yolo-onnx";
import { DetectorYoloOnnx } from "../../../yolo-onnx";
import { ClienteWorker, TEMPO_CARGA_WORKER_MS, TEMPO_INFERENCIA_WORKER_MS } from "../cliente-worker";
import type { InfoCargaWorker, MotorWorker } from "../protocolo";
import { avisoFallback, normalizarDispositivo } from "./comum";

/**
 * Motor de deteccao (COCO) com worker dedicado e fallback local.
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
  let motivoFallback: string | null = null;
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
    get motivoFallback() {
      return motivoFallback;
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
      // Nova tentativa de worker: o motivo anterior deixa de valer ate haver
      // nova falha.
      motivoFallback = null;
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
        motivoFallback = avisoFallback(status, nome, erro);
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
          motivoFallback = avisoFallback(status, nome, erro);
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
      motivoFallback = null;
    },
  };
}

/** Deteccao COCO em worker dedicado (fallback: YOLO local). */
export function criarMotorDeteccaoRemoto(): MotorDeteccao {
  return criarMotorDeteccaoComWorker("deteccao", () => new DetectorYoloOnnx());
}
