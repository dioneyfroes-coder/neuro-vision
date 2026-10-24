import { criarMotorGestosMediaPipe, MODELO_MAOS_PADRAO } from "../../gestos";
import type { MotorMaos } from "../adapters/hand-gesture.adapter";
import { atenderWorker, type MotorAtendido } from "./atender";

/**
 * Worker dedicado de maos/gestos (MediaPipe Gesture Recognizer).
 *
 * O worker usa `OffscreenCanvas`/`ImageBitmap` (o `gestos.ts` troca o
 * `new Image()` pelo caminho de bitmap quando `Image` nao existe). Se o SDK nao
 * funcionar no worker - por exemplo GPU sem contexto - a inicializacao falha e o
 * cliente cai no motor local da thread principal.
 */

let motor: MotorMaos | null = null;
let modeloAtual: string | null = null;
let dispositivo: string | null = null;

const maos: MotorAtendido = {
  get modelo() {
    return modeloAtual;
  },
  get dispositivo() {
    return dispositivo;
  },
  async carregar(idModelo, aoStatus) {
    modeloAtual = idModelo || MODELO_MAOS_PADRAO;
    motor = await criarMotorGestosMediaPipe(modeloAtual, aoStatus);
    dispositivo = motor.dispositivo ?? null;
  },
  async executar(imagem) {
    if (!motor) throw new Error("motor de maos nao carregado neste worker");
    return motor.executar(imagem);
  },
  encerrar() {
    motor?.encerrar?.();
    motor = null;
    modeloAtual = null;
    dispositivo = null;
  },
};

atenderWorker({ maos });
