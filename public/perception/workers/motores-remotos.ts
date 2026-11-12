import type { DeteccaoYOLO, MotorDeteccao, OpcoesInferenciaYolo } from "../../yolo-onnx";
import { DetectorYoloOnnx } from "../../yolo-onnx";
import { DetectorNsfwOnnx, MODELO_NSFW_PADRAO } from "../../nsfw-onnx";
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
): string {
  const detalhe = mensagemDe(erro);
  const origem = erro instanceof ErroWorker ? "worker" : "motor";
  const mensagem = `${origem} de ${motor} indisponivel (${detalhe}); usando a thread principal.`;
  aoStatus?.(mensagem);
  return mensagem;
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

/**
 * Classificador NSFW em worker dedicado, com **uma thread por modelo**.
 *
 * Diferente de `criarMotorDeteccaoComWorker`, este wrapper acompanha a troca de
 * modelo: ao carregar um id diferente, encerra a thread anterior e cria um novo
 * `ClienteWorker`. EraX, NudeNet 320n e NudeNet 640m nunca compartilham fila,
 * sessao ONNX nem runtime — mesmo que o arquivo do worker seja o mesmo.
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
