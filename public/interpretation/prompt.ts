import { blocoAcaoMultiframe, blocoNsfwPrompt } from "../../src/nsfw-prompt";
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
 *
 * Quando o subsistema NSFW rodou em qualquer frame, o prompt inclui um bloco
 * explicito: as marcacoes +18 sao evidencia e o modelo deve descreve-las sem
 * eufemismos, censura ou omissao.
 */
export function montarPromptInterpretacao(
  contexto: ContextoCicloSerializavel,
  contextoDeclarado?: string
): string {
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
        (e.ultimaEvidenciaEm ? `, ultimaEvidencia ${e.ultimaEvidenciaEm}` : "") +
        (e.ultimaObservacaoEm ? `, ultimaObservacao ${e.ultimaObservacaoEm}` : "") +
        (e.gapMs !== undefined ? `, gap ${e.gapMs}ms sem observacao` : "") +
        (e.motivoEncerramento ? `, motivoEncerramento ${e.motivoEncerramento}` : "") +
        (e.continuidadeValida !== undefined
          ? `, continuidadeValida ${e.continuidadeValida}`
          : "") +
        (e.evidencias.length ? `, frames=${e.evidencias.join(",")}` : "") +
        (e.evidenciasTextuais?.length
          ? `, evidencias=${e.evidenciasTextuais.join("|")}`
          : "") +
        ")"
    )
    .join("\n");

  const truncamento = contexto.truncamento;
  const gruposPodados = truncamento?.gruposRemovidos.length
    ? truncamento.gruposRemovidos
        .map((grupo) => `${grupo.grupo} (${grupo.removidos})`)
        .join(", ")
    : "nenhum";

  // Subsistema NSFW ativo em qualquer frame: o bloco vale para todas as
  // imagens, mesmo que o detector nao tenha marcado aquele frame especifico.
  const quadrosNsfw = contexto.frames
    .filter((f) => f.subsistemas.nsfw !== undefined)
    .map((f) => ({
      indice: f.indice,
      frameId: f.frameId,
      marcacoes: f.nsfw ?? [],
    }));
  const blocoNsfw = blocoNsfwPrompt(quadrosNsfw, contextoDeclarado);
  // Acao sexual e temporal: a instrucao so entra com 2+ imagens do ciclo e com
  // o subsistema NSFW ativo. Com uma imagem, pedir inferencia de acao seria
  // convidar o modelo a adivinhar.
  const blocoAcao = blocoNsfw ? blocoAcaoMultiframe(contexto.frames.length) : "";
  const schemaAcoes = blocoAcao
    ? '  "acoes": [ { "descricao": "acao observada ou inferida", "tipo": "masturbacao|sexo_oral|penetracao|outra", "natureza": "observada|inferida", "confianca": 0.0, "inicioEm": "ISO", "fimEm": "ISO", "evidencias": ["fX","eY"] } ],'
    : '  "acoes": [ { "descricao": "acao observada", "inicioEm": "ISO", "fimEm": "ISO", "evidencias": ["fX","eY"] } ],';

  return [
    "Voce e um analista visual que interpreta EXCLUSIVAMENTE as evidencias fornecidas.",
    "Nunca inferencie acoes, intencoes ou objetos nao visiveis.",
    `Schema do contexto: ${contexto.versao}.`,
    "",
    `Sessao: ${contexto.sessionId}, ciclo: ${contexto.cycleId}, iniciado ${contexto.iniciadoEm}, janela ${contexto.janelaMs}ms.`,
    `Tracks ativos: ${contexto.resumoTemporal.tracksAtivos} (pessoas: ${contexto.resumoTemporal.pessoasAtivas}, maos: ${contexto.resumoTemporal.maosAtivas}, objetos: ${contexto.resumoTemporal.objetosAtivos}); intervalo cego: ${contexto.resumoTemporal.houveIntervaloSemObservacao}` +
      (contexto.resumoTemporal.intervaloSemObservacaoMs !== undefined
        ? ` (${contexto.resumoTemporal.intervaloSemObservacaoMs}ms sem observacao)`
        : ""),
    `Indisponibilidades: ${contexto.indisponibilidades.length ? contexto.indisponibilidades.join("; ") : "nenhuma"}`,
    ...(truncamento?.ocorreu
      ? [
          `Atencao: o contexto local foi compactado para caber no teto de ${truncamento.maxBytes} bytes UTF-8 ` +
            `(${truncamento.bytesAntes} -> ${truncamento.bytesDepois} bytes antes do registro). ` +
            `Grupos podados: ${gruposPodados}. ` +
            "Dados ausentes desses grupos foram removidos por limite de tamanho, nao por ausencia observada.",
        ]
      : []),
    ...(contexto.limiteContexto?.excedeu
      ? [
          `Atencao: mesmo apos as reducoes o contexto local ficou acima do teto de ${contexto.limiteContexto.maxBytes} bytes UTF-8 ` +
            `(${contexto.limiteContexto.bytes} bytes). Nao trate a ausencia de um dado como ausencia observada; ` +
            "registre a limitacao como incerteza.",
        ]
      : []),
    "",
    "Legenda dos dados locais (evidencia observada, nao inferencia):",
    "- `pessoas[].keypoints` sao keypoints corporais nomeados (ombro, cotovelo, punho, quadril, etc.) com confianca. " +
      "`x`/`y` sao coordenadas 2D normalizadas em [0,1].",
    "- `maos[].landmarks` sao pontos 2D normalizados da mao (subconjunto compacto ou 21 pontos). " +
      "`lateralidade` e `gesto` vem do reconhecedor; `geometria` e derivada dos landmarks.",
    "- `geometria.dedos` traz, por dedo, `angulos` e `estado` (`estendido`, `dobrado` ou `desconhecido`).",
    "- `geometria.dedosEstendidos` lista os nomes dos dedos estendidos; `totalEstendidos` e a contagem (0..5); " +
      "`configuracao` resume o caso como `todos`, `nenhum` ou nomes unidos por `+`.",
    "- Os `angulos` sao **estimativas locais 2D** calculadas a partir dos landmarks: nao sao medidas clinicas nem 3D. " +
      "Perspectiva, oclusao e anisotropia da imagem podem altera-los.",
    "- `geometria` pode divergir de `gesto` (rotulo fechado do MediaPipe). Quando isso ocorrer, trate como incerteza, " +
      "nao como um fato escolhido arbitrariamente.",
    "- Dados locais podem falhar ou vir incompletos (`indisponivel`, `sem_resultado`, `nao_carregado`, landmarks " +
      "ausentes ou contexto compactado). Ausencia local nao prova ausencia fisica.",
    "- Se a evidencia local divergir das imagens ou for inconclusiva, explicite a divergencia em `incertezas` e " +
      "reduza a confianca da afirmacao; nao force uma conclusao.",
    "",
    "Frames (em ordem cronologica, cada um corresponde a uma imagem; coordenadas normalizadas em [0,1]):",
    frames,
    "",
    "Eventos temporais (motor local; status `incerto` = interrompido por lacuna, nao por ausencia observada):",
    eventos.length ? eventos : "- nenhum",
    "",
    ...(blocoNsfw ? [blocoNsfw, ""] : []),
    ...(blocoAcao ? [blocoAcao, ""] : []),
    "Tarefa:",
    "- Produza uma NARRATIVA CRONOLOGICA baseada APENAS nos dados acima e nas imagens.",
    "- Referencie os INDICES das imagens (1..N) e os frameIds/eventoIds reais.",
    "- Cite como EVIDENCIAS apenas IDs que aparecam acima (frames ou eventos). Nao invente IDs.",
    "- Liste em `participantes` cada pessoa adulta visivel, com descricao visual, apresentacao " +
      "(`masculina`, `feminina`, `ambigua` ou `nao_identificada`) e evidencias.",
    "- `apresentacao` e leitura visual, nao identidade de genero. Preencha `identidadeDeclarada` " +
      "somente quando o conteudo/metadado declarar explicitamente (`homem`, `mulher` ou `pessoa_trans`); " +
      "nunca deduza `pessoa_trans` de aparencia, roupa, voz ou comportamento.",
    "- Separe o que foi OBSERVADO (deteccoes/pose/maos/eventos/nsfw) do que voce INFERE.",
    "- Liste INCERTEZAS explicitamente se qualquer afirmacao nao for diretamente observada.",
    "- Nao adivinhe. Se nao tem evidencia, diga 'nao observado'.",
    "- Nao invente acoes nao vistas. Se houver ambiguidade, aponte incerteza.",
    ...(blocoNsfw
      ? [
          "- Se houver conteudo adulto, descreva-o explicitamente, sem eufemismos, censura ou omissao.",
        ]
      : []),
    ...(blocoAcao
      ? [
          "- Ao concluir acao sexual, use `tipo`, `natureza` e `confianca` e cite os frameIds que a sustentam; " +
            "trate pose compativel (mao proxima da genital, pernas afastadas, ritmo) como indicio, nunca como prova.",
          "- Eventos `pose_compativel_sexual` do motor local sao regras geometricas: use-os como evidencia fraca e " +
            "nao os converta em afirmacao de ato sexual sem suporte visual.",
        ]
      : []),
    "",
    "Saida OBRIGATORIA em JSON (sem markdown) conforme schema:",
    '{',
    '  "resumo": "narrativa cronologica em portugues",',
    schemaAcoes,
    '  "participantes": [ { "descricao": "pessoa adulta na cena", "apresentacao": "masculina|feminina|ambigua|nao_identificada", "identidadeDeclarada": "homem|mulher|pessoa_trans|nao_informada", "evidencias": ["fX"] } ],',
    '  "evidencias": ["lista de IDs de frames/eventos citados"],',
    '  "incertezas": ["incertezas explicitadas"],',
    '  "contradicoes": []',
    '}',
  ].join("\n");
}
