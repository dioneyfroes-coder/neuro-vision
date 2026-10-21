import type { ContextoCicloSerializavel } from "./esquema";

/**
 * Construcao do prompt para a interpretacao multimodal (Etapa 7; Fase 3).
 *
 * Instrui o modelo a produzir uma narrativa cronologica baseada SOMENTE nas
 * evidencias observadas (o JSON estruturado e as imagens), referenciando os
 * indices das imagens e os `frameId`/`eventoId` reais, citando evidencias,
 * explicitando incertezas e evitando adivinhar acoes nao vistas. Exige saida
 * JSON estruturada.
 *
 * O contexto e **evidencia observada**: nao deve ser repetido como se fosse
 * inferencia. A tarefa distingue explicitamente o que foi observado do que o
 * modelo conclui — a saida vai no bloco de inferencia.
 */
export function montarPromptInterpretacao(contexto: ContextoCicloSerializavel): string {
  const frames = contexto.frames
    .map((f) => {
      // Variante B nao envia dados locais: os subsistemas vem `nao_carregado`.
      const locais = [
        `subs. det=${f.subsistemas.deteccao.status} pose=${f.subsistemas.pose.status} maos=${f.subsistemas.maos.status}` +
          (f.subsistemas.nsfw ? ` nsfw=${f.subsistemas.nsfw.status}` : ""),
      ];
      if (f.deteccoes.length) locais.push(`det=${JSON.stringify(f.deteccoes)}`);
      if (f.pessoas.length) locais.push(`pessoas=${JSON.stringify(f.pessoas)}`);
      if (f.maos.length) locais.push(`maos=${JSON.stringify(f.maos)}`);
      if (f.movimento.length) locais.push(`movimento=${JSON.stringify(f.movimento)}`);
      if (f.nsfw) locais.push(`nsfw=${JSON.stringify(f.nsfw)}`);
      return (
        `- Imagem ${f.indice} (frameId ${f.frameId}, t ${f.capturadoEm}, ` +
        `offset ${f.offsetMs}ms): ${locais.join("; ")}`
      );
    })
    .join("\n");

  const eventos = contexto.eventosTemporais
    .map(
      (e) =>
        `- ${e.eventoId} [${e.tipo}] ${e.descricao} (inicio ${e.inicioEm}` +
        (e.fimEm ? `, fim ${e.fimEm}` : "") +
        `, status ${e.status}` +
        (e.trackId ? `, track ${e.trackId}` : "") +
        (e.confianca !== undefined ? `, conf ${e.confianca}` : "") +
        (e.gapMs !== undefined ? `, gap ${e.gapMs}ms sem observacao` : "") +
        (e.evidencias.length ? `, frames=${e.evidencias.join(",")}` : "") +
        ")"
    )
    .join("\n");

  return [
    "Voce e um analista visual que interpreta EXCLUSIVAMENTE as evidencias fornecidas.",
    "Nunca inferencie acoes, intencoes ou objetos nao visiveis.",
    `Schema do contexto: ${contexto.versao}.`,
    "",
    `Sessao: ${contexto.sessionId}, ciclo: ${contexto.cycleId}, iniciado ${contexto.iniciadoEm}, janela ${contexto.janelaMs}ms.`,
    `Entidades ativas: ${contexto.resumoTemporal.entidadesAtivas}, intervalo cego: ${contexto.resumoTemporal.houveIntervaloSemObservacao}` +
      (contexto.resumoTemporal.intervaloSemObservacaoMs !== undefined
        ? ` (${contexto.resumoTemporal.intervaloSemObservacaoMs}ms sem observacao)`
        : ""),
    `Indisponibilidades: ${contexto.indisponibilidades.length ? contexto.indisponibilidades.join("; ") : "nenhuma"}`,
    "",
    "Frames (em ordem cronologica, cada um corresponde a uma imagem; coordenadas normalizadas em [0,1]):",
    frames,
    "",
    "Eventos temporais (motor local; status `incerto` = interrompido por lacuna, nao por ausencia observada):",
    eventos.length ? eventos : "- nenhum",
    "",
    "Tarefa:",
    "- Produza uma NARRATIVA CRONOLOGICA baseada APENAS nos dados acima e nas imagens.",
    "- Referencie os INDICES das imagens (1..N) e os frameIds/eventoIds reais.",
    "- Cite como EVIDENCIAS apenas IDs que aparecam acima (frames ou eventos). Nao invente IDs.",
    "- Separe o que foi OBSERVADO (deteccoes/pose/maos/eventos) do que voce INFERE.",
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
