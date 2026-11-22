/**
 * Armazenamento dos bytes de vídeo dos segmentos de monitoramento (Fase 3).
 *
 * Fachada: implementação dividida por responsabilidade em `./armazenador-videos/*`.
 */
export type {
  ArquivoVideoSegmento,
  MotivoErroVideo,
  OpcoesArmazenadorVideos,
  ResultadoAplicacaoRetencao,
  DadosUploadVideo,
  VideoArmazenado,
} from "./armazenador-videos/tipos";
export { ArquivoVideoError } from "./armazenador-videos/tipos";
export { ArmazenadorVideos } from "./armazenador-videos/armazenador";
