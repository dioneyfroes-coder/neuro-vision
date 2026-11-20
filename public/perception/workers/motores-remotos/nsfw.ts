import type { DeteccaoYOLO, MotorDeteccao, OpcoesInferenciaYolo } from "../../../yolo-onnx";
import { DetectorNsfwOnnx, MODELO_NSFW_PADRAO } from "../../../nsfw-onnx";
import { ClienteWorker, TEMPO_CARGA_WORKER_MS, TEMPO_INFERENCIA_WORKER_MS } from "../cliente-worker";
import type { InfoCargaWorker } from "../protocolo";
import { avisoFallback, normalizarDispositivo } from "./comum";

/**
 * Classificador NSFW em worker dedicado, com **uma thread por modelo**.
 *
 * Diferente de `criarMotorDeteccaoComWorker`, este wrapper acompanha a troca de
 * modelo: ao carregar um id diferente, encerra a thread anterior e cria um novo
 * `ClienteWorker`. EraX, NudeNet 320n e NudeNet 640m nunca compartilham fila,
 * sessao ONNX nem runtime - mesmo que o arquivo do worker seja o mesmo.
 *
 * O fallback local tambem e recriado por modelo, para nao herdar a sessao de
 * outro `.onnx` quando o worker nao esta disponivel.
 */
export function criarMotorNsfwRemoto(): MotorDeteccao {
  let cliente: ClienteWorker | null = null;
  let local: DetectorNsfwOnnx | null = null;
  let modelo: string | null = null;
  let modeloWorker: string | null = null;
  let dispositivo: "webgpu" | "wasm" | null = null;
  let tempoCargaMs: number | null = null;
  let motivoFallback: string | null = null;
  let status: ((mensagem: string) => void) | undefined;

  const encerrarCliente = (): void => {
    cliente?.encerrar();
    cliente = null;
    modeloWorker = null;
  };
  const encerrarLocal = (): void => {
    local?.encerrar();
    local = null;
  };

  const garantirLocal = async (alvo: string): Promise<MotorDeteccao> => {
    if (!local) {
      local = new DetectorNsfwOnnx();
      local.aoStatus = status;
      await local.carregar(alvo, status);
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
      const alvo = idModelo?.trim() || MODELO_NSFW_PADRAO;
      // Mesmo modelo ja carregado: reutiliza a thread atual.
      if (cliente?.ativo && modeloWorker === alvo) return;
      // Troca de modelo: cada modelo ocupa a propria thread. Encerrar antes de
      // criar evita duas sessoes ONNX do mesmo runtime competindo no mesmo
      // worker e libera a memoria do modelo anterior.
      encerrarCliente();
      encerrarLocal();
      modelo = alvo;
      // Nova tentativa de worker para este modelo: limpa o motivo anterior.
      motivoFallback = null;
      try {
        cliente = new ClienteWorker("nsfw");
        cliente.aoStatus = status;
        const info = await cliente.requisitar<InfoCargaWorker>(
          { tipo: "carregar", motor: "nsfw", modelo: alvo },
          TEMPO_CARGA_WORKER_MS
        );
        dispositivo = normalizarDispositivo(info.dispositivo);
        tempoCargaMs = info.tempoCargaMs;
        modelo = info.modelo ?? alvo;
        modeloWorker = alvo;
        return;
      } catch (erro) {
        encerrarCliente();
        motivoFallback = avisoFallback(status, `nsfw (${alvo})`, erro);
      }
      await garantirLocal(alvo);
    },

    async executar(imagem: string, opcoes?: OpcoesInferenciaYolo): Promise<DeteccaoYOLO[]> {
      if (cliente?.ativo) {
        try {
          return await cliente.requisitar<DeteccaoYOLO[]>(
            {
              tipo: "executar",
              motor: "nsfw",
              imagem,
              threshold: opcoes?.threshold,
              percentage: opcoes?.percentage,
            },
            TEMPO_INFERENCIA_WORKER_MS
          );
        } catch (erro) {
          encerrarCliente();
          motivoFallback = avisoFallback(status, "nsfw", erro);
        }
      }
      const alvo = modelo ?? MODELO_NSFW_PADRAO;
      return (await garantirLocal(alvo)).executar(imagem, opcoes);
    },

    encerrar() {
      encerrarCliente();
      encerrarLocal();
      modelo = null;
      dispositivo = null;
      tempoCargaMs = null;
      motivoFallback = null;
    },
  };
}
