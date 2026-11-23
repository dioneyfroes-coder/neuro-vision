/**
 * Seleção automática de frames relevantes para o contexto multimodal
 * (Fase 6, item 2).
 *
 * A seleção anterior era apenas temporal/uniforme (preserva primeiro e último).
 * Aqui a relevância é derivada **somente de sinais locais já medidos**: eventos
 * que o frame sustenta, atividade detectada e falha de percepção. Falha ou
 * oclusão nunca viram "ausência" — o frame é mantido com motivo explícito.
 * Quando não há nenhum sinal de relevância, a regra cai exatamente para a
 * amostragem uniforme anterior, preservando o comportamento legado.
 */
export interface FrameParaSelecao {
  frameId: string;
  capturadoEmMs: number;
  /** IDs de eventos cuja evidência inclui este frame. */
  eventosSuportados?: readonly string[];
  /** `false` quando pelo menos um subsistema necessário não produziu leitura. */
  percepcaoValida?: boolean;
  /** Falha explícita de percepção no frame — sinal, não ausência. */
  falhaPercepcao?: boolean;
  /** Contagem de sinais de atividade (detecções/movimento), quando medida. */
  sinaisAtividade?: number;
  /**
   * Sinal NSFW fraco (0–5) derivado de propostas de ação/concordância entre
   * detectores (Fase 4). Nunca equivale a evento temporal validado.
   */
  sinaisNsfw?: number;
  /** Motivos do sinal NSFW, rastreáveis no diagnóstico da seleção. */
  motivosNsfw?: readonly string[];
}

export type CriterioSelecaoFrames = "relevancia" | "uniforme" | "sem_selecao";

export interface DiagnosticoSelecaoFrames {
  criterio: CriterioSelecaoFrames;
  maxFrames: number;
  totalFrames: number;
  /** IDs selecionados, em ordem cronológica. */
  selecionados: string[];
  /** Motivo por frame selecionado (rastreável no resultado da interpretação). */
  motivos: Record<string, string>;
}

/**
 * Seleciona até `maxFrames`, preservando o primeiro e o último frame da janela.
 * Ordem de desempate: maior pontuação, depois posição cronológica mais cedo.
 */
export function selecionarFramesRelevantes(
  frames: readonly FrameParaSelecao[],
  maxFrames: number,
  eventosRelevantes: readonly string[] = []
): DiagnosticoSelecaoFrames {
  const diagnostico: DiagnosticoSelecaoFrames = {
    criterio: "sem_selecao",
    maxFrames,
    totalFrames: frames.length,
    selecionados: [],
    motivos: {},
  };
  if (maxFrames <= 0 || frames.length === 0) return diagnostico;

  const ordenados = frames
    .map((frame, indice) => ({ frame, indice }))
    .sort((a, b) => a.frame.capturadoEmMs - b.frame.capturadoEmMs || a.indice - b.indice);

  if (ordenados.length <= maxFrames) {
    diagnostico.criterio = "uniforme";
    for (const { frame } of ordenados) {
      diagnostico.selecionados.push(frame.frameId);
      diagnostico.motivos[frame.frameId] = "todos_os_frames_cabem";
    }
    return diagnostico;
  }
  if (maxFrames === 1) {
    const ultimo = ordenados[ordenados.length - 1].frame;
    diagnostico.criterio = "uniforme";
    diagnostico.selecionados = [ultimo.frameId];
    diagnostico.motivos[ultimo.frameId] = "unico_frame_permitido";
    return diagnostico;
  }

  const relevantes = new Set(eventosRelevantes);
  const pontuados = ordenados.map(({ frame }, posicao) => {
    const suporte = frame.eventosSuportados ?? [];
    const suporteRelevante = suporte.filter((id) => relevantes.has(id));
    const sinais = Math.max(0, Math.min(5, Math.floor(frame.sinaisAtividade ?? 0)));
    let pontos = 1;
    const razoes: string[] = [];
    if (suporteRelevante.length > 0) {
      pontos += 100 * suporteRelevante.length;
      razoes.push(`evento_relevante:${suporteRelevante.join("|")}`);
    } else if (suporte.length > 0) {
      pontos += 40;
      razoes.push("evento_suportado");
    }
    if (frame.falhaPercepcao) {
      pontos += 25;
      razoes.push("falha_percepcao_sinalizada");
    } else if (frame.percepcaoValida === false) {
      pontos += 20;
      razoes.push("percepcao_indisponivel");
    }
    if (sinais > 0) {
      pontos += 10 * sinais;
      razoes.push(`atividade:${sinais}`);
    }
    // Sinal NSFW é fraco por princípio: detector sozinho nunca confirma ação.
    const sinaisNsfw = Math.max(0, Math.min(5, Math.floor(frame.sinaisNsfw ?? 0)));
    if (sinaisNsfw > 0) {
      pontos += 2 * sinaisNsfw;
      razoes.push(`nsfw_sinal:${sinaisNsfw}`, ...(frame.motivosNsfw ?? []));
    }
    return { frame, posicao, pontos, razoes: razoes.length ? razoes : ["linha_do_tempo"] };
  });

  const temRelevancia = pontuados.some((p) => p.razoes[0] !== "linha_do_tempo");
  if (!temRelevancia) {
    const indices = amostrarUniformemente(ordenados.length, maxFrames);
    for (const i of indices) {
      const { frame } = ordenados[i];
      diagnostico.selecionados.push(frame.frameId);
      diagnostico.motivos[frame.frameId] = "amostragem_uniforme";
    }
    diagnostico.criterio = "uniforme";
    return diagnostico;
  }

  const escolhidos = new Set<number>([0, ordenados.length - 1]);
  const candidatos = pontuados
    .slice(1, -1)
    .slice()
    .sort((a, b) => b.pontos - a.pontos || a.posicao - b.posicao);
  for (const candidato of candidatos) {
    if (escolhidos.size >= Math.min(maxFrames, ordenados.length)) break;
    escolhidos.add(candidato.posicao);
  }
  for (const indice of [...escolhidos].sort((a, b) => a - b)) {
    const { frame, razoes } = pontuados[indice];
    diagnostico.selecionados.push(frame.frameId);
    diagnostico.motivos[frame.frameId] = razoes.join("+");
  }
  diagnostico.criterio = "relevancia";
  return diagnostico;
}

/** Mesma matemática da amostragem uniforme legada (primeiro/último preservados). */
function amostrarUniformemente(total: number, max: number): number[] {
  const passo = (total - 1) / (max - 1);
  const indices: number[] = [];
  for (let i = 0; i < max; i += 1) indices.push(Math.round(i * passo));
  return [...new Set(indices)];
}
