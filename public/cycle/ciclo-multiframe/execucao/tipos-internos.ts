import type { ProcessamentoFrame } from "../tipos";

/**
 * Resultado interno do processamento concorrente de um frame: o `processamento`
 * sempre existe; `falha` so aparece quando o processador lancou (o fallback
 * marca os subsistemas como `indisponivel`). Permite preservar a ordem das
 * observacoes independentemente da ordem de conclusao.
 */
export interface FrameProcessado {
  processamento: ProcessamentoFrame;
  falha?: string;
}
