import type { ContextoCicloSerializavel } from "./contexto";

/**
 * Construcao do prompt para a interpretacao multimodal (Etapa 7 do roteiro).
 *
 * Instrui o modelo a produzir uma narrativa cronologica baseada SOMENTE nas
 * observacoes presentes, referenciando os indices das imagens (frameId/timestamp),
 * citando evidencias, explicitando incertezas e evitando adivinhar acoes nao
 * vistas. Exige saida JSON estruturada.
 */
export function montarPromptInterpretacao(contexto: ContextoCicloSerializavel): string {
  const frames = contexto.frames
    .map((f) => {
      // Variante B nao envia dados locais: os campos vem vazios e nao devem
      // sugerir "indisponivel" (nao houve tentativa de percepcao local).
      const locais = [
        f.deteccoes ? `det=${f.deteccoes}` : "",
        f.pose ? `pose=${f.pose}` : "",
        f.maos ? `maos=${f.maos}` : "",
        // NSFW experimental: presente somente quando o subsistema rodou.
        f.nsfw ? `nsfw=${f.nsfw}` : "",
      ]
        .filter(Boolean)
        .join("; ");
      const detalhe = locais ? `: ${locais}` : "";
      const pontos = f.pontos.length ? `; pontos=${JSON.stringify(f.pontos)}` : "";
      return (
        `- Imagem ${f.indice} (frameId ${f.frameId}, t ${f.capturadoEm}, ` +
        `offset ${f.offsetMs}ms)${detalhe}${pontos}`
      );
    })
    .join("\n");

  const eventos = contexto.eventosTemporais
    .map(
      (e) =>
        `- ${e.tipo}: ${e.descricao} (inicio ${e.inicioEm}${e.fimEm ? `, fim ${e.fimEm}` : ""}` +
        (e.confianca !== undefined ? `, conf ${e.confianca}` : "") +
        (e.frameIds.length ? `, frames=${e.frameIds.join(",")}` : "") +
        ")"
    )
    .join("\n");

  return [
    "Voce e um analista visual que interpreta EXCLUSIVAMENTE as evidencias fornecidas.",
    "Nunca inferencie acoes, intencoes ou objetos nao visiveis.",
    "",
    `Sessao: ${contexto.sessionId}, ciclo: ${contexto.cycleId}, iniciado ${contexto.iniciadoEm}, janela ${contexto.janelaMs}ms.`,
    `Entidades ativas: ${contexto.resumoTemporal.entidadesAtivas}, intervalo cego: ${contexto.resumoTemporal.houveIntervaloSemObservacao}` +
      (contexto.resumoTemporal.intervaloSemObservacaoMs !== undefined
        ? ` (${contexto.resumoTemporal.intervaloSemObservacaoMs}ms sem observacao)`
        : ""),
    `Indisponibilidades: ${contexto.indisponibilidades.length ? contexto.indisponibilidades.join("; ") : "nenhuma"}`,
    "",
    "Frames (em ordem cronologica, cada um corresponde a uma imagem):",
    frames,
    "",
    "Eventos temporais (motor local):",
    eventos.length ? eventos : "- nenhum",
    "",
    "Tarefa:",
    "- Produza uma NARRATIVA CRONOLOGICA baseada APENAS nos dados acima.",
    "- Referencie os INDICES das imagens (1..N) e, quando pertinente, frameIds.",
    "- Liste EVIDENCIAS (IDs de frames ou eventos) que sustentam a conclusao.",
    "- Liste INCERTEZAS explicitamente se qualquer afirmacao nao for diretamente observada.",
    "- Nao adivinhe. Se nao tem evidencia, diga 'nao observado'.",
    "- Nao invente acoes nao vistas. Se houver ambiguidade, aponte incerteza.",
    "",
    "Saida OBRIGATORIA em JSON (sem markdown) conforme schema:",
    '{',
    '  "resumo": "narrativa cronologica em portugues",',
    '  "acoes": [ { "descricao": "acao observada", "inicioEm": "ISO", "fimEm": "ISO", "evidencias": ["fX","eY"] } ],',
    '  "evidencias": ["lista de IDs de frames/eventos citados"],',
    '  "incertezas": ["incertezas explicitadas"],',
    '  "contradicoes": []',
    '}',
  ].join("\n");
}
