import { DetectorNsfwOnnx } from "../../nsfw-onnx";
import { DetectorYoloOnnx } from "../../yolo-onnx";
import { atenderWorker } from "./atender";

/**
 * Worker unico do `onnxruntime-web`: deteccao COCO e NSFW experimental.
 *
 * As duas sessoes compartilham o runtime e o cache de sessao por URL dentro
 * deste worker (mesmo modulo `yolo-onnx`), mas cada detector tem sua propria
 * instancia. A thread principal so recebe o resultado ja interpretado.
 */
atenderWorker({
  deteccao: new DetectorYoloOnnx(),
  nsfw: new DetectorNsfwOnnx(),
});
