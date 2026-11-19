/**
 * Adaptador do classificador **NSFW experimental** (YOLO treinado para conteudo
 * sensivel, em ONNX) para a porta `ClassificadorNsfw`.
 *
 * Reaproveita o contrato interno `MotorDeteccao` do YOLO COCO — a saida tem o
 * mesmo formato — e converte em `ResultadoNsfw`: rotulos do proprio modelo,
 * caixas em pixels e confianca em [0, 1]. Falha de carga/inferencia propaga como
 * `ErroPercepcao` (o pipeline a converte em `indisponivel`, isolando o frame).
 */

export { AdaptadorClassificadorNsfw } from "./nsfw-classifier/adapter-unitario";
export { LIMITE_IOU_MESCLA_NSFW, mesclarMarcacoesNsfw } from "./nsfw-classifier/mesclagem";
export type { CriadorAdaptadorNsfw, OpcoesConjuntoNsfw } from "./nsfw-classifier/conjunto";
export { AdaptadorNsfwConjunto } from "./nsfw-classifier/conjunto";
