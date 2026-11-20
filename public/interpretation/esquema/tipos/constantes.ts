/** Versao do schema. Sobe quando a forma dos campos muda de modo incompativel. */
export const VERSAO_ESQUEMA_CONTEXTO = "contexto-1";

/**
 * Nomes dos 17 keypoints na ordem COCO usada pelo estimador de pose padrao
 * (YOLOv8-pose). O indice no array `pontos` corresponde a posicao aqui.
 */
export const NOMES_KEYPOINTS_COCO: readonly string[] = [
  "nariz",
  "olho_esquerdo",
  "olho_direito",
  "orelha_esquerda",
  "orelha_direita",
  "ombro_esquerdo",
  "ombro_direito",
  "cotovelo_esquerdo",
  "cotovelo_direito",
  "punho_esquerdo",
  "punho_direito",
  "quadril_esquerdo",
  "quadril_direito",
  "joelho_esquerdo",
  "joelho_direito",
  "tornozelo_esquerdo",
  "tornozelo_direito",
];

/**
 * Keypoints que sustentam postura/gesto e nunca sao descartados na compactacao
 * por bytes: ombros, cotovelos, pulsos e quadris. Membros inferiores/perifericos

 */
export const KEYPOINTS_ESSENCIAIS: readonly string[] = [
  "ombro_esquerdo",
  "ombro_direito",
  "cotovelo_esquerdo",
  "cotovelo_direito",
  "punho_esquerdo",
  "punho_direito",
  "quadril_esquerdo",
  "quadril_direito",
];
