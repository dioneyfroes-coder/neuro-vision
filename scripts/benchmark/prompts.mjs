export const PROMPT_TEXTO =
  "Escreva em portugues tres frases curtas descrevendo uma cena de escritorio com pessoas e objetos.";
const PROMPT_ANALISE_PROFUNDA =
  "Analise profundamente a imagem inteira: identifique pessoas e objetos visiveis, posicoes, relacoes espaciais e detalhes relevantes. Descreva somente o que a imagem sustenta e indique incertezas, sem inventar elementos.";
export const PROMPT_VISAO = `Voce observa um frame de uma webcam.\n\n${PROMPT_ANALISE_PROFUNDA}`;

export function montarPromptVisao(prompt) {
  return prompt ? `${prompt}\n\n${PROMPT_ANALISE_PROFUNDA}` : PROMPT_VISAO;
}

// Imagem sintetica 1x1 (GIF) usada quando nao ha snapshot disponivel.
export const SVG_BASE = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";