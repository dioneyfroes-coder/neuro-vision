#!/usr/bin/env node

/**
 * Verificacao empirica do classificador **NSFW experimental**.
 *
 * Espelha `scripts/verificar-yolo-onnx.mjs`, mas usa os pesos LOCAIS exportados
 * por `scripts/exportar-yolo-nsfw.mjs` (`modelos/yolonsfw/*.onnx`, gitignored) e
 * os rotulos do sidecar `<modelo>.onnx.json`. A inferencia roda em WASM **no
 * Chromium** (mesmo runtime/caminho de producao) sobre um frame real de
 * `bench/videos/frames/`. O pre-pos-processamento espelha `public/nsfw-onnx.ts`:
 *   stretch quadrado -> /255 RGB NCHW -> caixas na resolucao original.
 *
 * Dois formatos de saida sao aceitos, como no cliente:
 *   - `[1, 300, 6]` (EraX e NudeNet 640m exportado): NMS embutido;
 *   - `[1, 22, N]` (NudeNet 320n): 4 coordenadas + 18 classes, com NMS em JS.
 *
 * O lado da entrada vem do nome do modelo: `nudenet_320n` usa 320x320; os
 * demais usam 640x640. Limiares por classe seguem `LIMIARES_NSFW` do cliente.
 *
 * Sai com codigo 1 se a carga falhar, se a saida nao tiver a forma esperada,
 * se alguma caixa sair dos limites ou se o modelo devolver rotulo desconhecido
 * (`classe N`) — sinal de sidecar ausente/divergente.
 *
 * Uso: node scripts/verificar-yolo-nsfw.mjs [modelo] [frame.jpg] [limiar]
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "./verificar-yolo-nsfw/cli.mjs";

export { obterMimeEntrada, validarAmostras, ladoDoModelo, parsearArgumentos } from "./verificar-yolo-nsfw/args.mjs";
export { interpretarFaixaBytes } from "./verificar-yolo-nsfw/servidor.mjs";

const caminhoDoModulo = fileURLToPath(import.meta.url);
const executadoDiretamente =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === caminhoDoModulo;

if (executadoDiretamente) {
  main().catch((erro) => {
    console.error(erro);
    process.exit(1);
  });
}