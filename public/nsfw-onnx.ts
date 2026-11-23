/**
 * Detector **NSFW experimental** — runtime `onnxruntime-web` em WASM vindo do
 * CDN sob demanda, sessao compartilhada por URL e pre-processamento stretch
 * `/255` NCHW.
 *
 * O catalogo cobre duas familias:
 *
 * - **EraX NSFW YOLO11** (`erax_nsfw_yolo11n/s/m`): 5 classes, exportado com
 *   NMS embutido (`[1, 300, 6]`), lado 640.
 * - **NudeNet v3.4** (`nudenet_320n`, `nudenet_640m`): 18 classes, incluindo
 *   `MALE_GENITALIA_EXPOSED` e `FEMALE_GENITALIA_COVERED`. O 320n devolve a
 *   saida crua YOLOv8 (`[1, 22, N]`); o 640m e exportado com NMS (`[1, 300, 6]`).
 *
 * Cada modelo tem seu proprio Worker (ver `perception/workers/`). Este modulo
 * nao compartilha sessao ONNX entre modelos diferentes: a chave da sessao e a
 * URL final do `.onnx`.
 *
 * Os pesos **nao vem de CDN publica**: ficam em `modelos/yolonsfw/` (gitignored)
 * e sao servidos pelo proprio servidor em `/yolonsfw/`. O 320n vem pronto do
 * NudeNet; o 640m e exportado por `scripts/exportar-yolo-nsfw.mjs`.
 */

export {
  CLASSES_NUDENET,
  DIR_NSFW,
  LIMIARES_NSFW,
  MODELOS_NSFW,
  MODELOS_NSFW_CONJUNTO,
  MODELO_NSFW_CONJUNTO,
  MODELO_NSFW_PADRAO,
  LIMIARES_NSFW_POR_MODELO,
  criarResolutorLimiarNsfw,
  definicaoModeloNsfw,
  limiarEfetivoNsfw,
  limiarMinimoNsfw,
  resolverLimiarNsfw,
  urlModeloNsfw,
  type DefinicaoModeloNsfw,
  type OpcoesLimiarNsfw,
} from "./nsfw-onnx/catalogo";
export {
  MODELOS_POR_PERFIL_NSFW,
  PERFIS_MODELOS_NSFW,
  modelosDoPerfilNsfw,
  normalizarPerfilModelosNsfw,
  type PerfilModelosNsfw,
} from "./nsfw-onnx/perfis";
export {
  CLASSES_NSFW_IGNORADAS,
  filtrarClassesNsfwRelevantes,
  filtrarDeteccoesNsfw,
  formatoSaidaNsfw,
  interpretarSaidaNudeNetCru,
  nmsPorRotulo,
  type FormatoSaidaNsfw,
} from "./nsfw-onnx/interpretacao";
export { DetectorNsfwOnnx } from "./nsfw-onnx/detector";
