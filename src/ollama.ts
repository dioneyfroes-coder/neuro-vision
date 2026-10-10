export interface OpcoesGerarDescricao {
  modelo?: string;
  prompt?: string;
  host?: string;
  timeoutMs?: number;
  anterior?: string;
}

export interface ResultadoDescricao {
  texto: string;
  modelo: string;
  tokens: number;
  duracaoMs: number;
}

export const PROMPT_DESCRICAO =
  "Voce observa um frame de uma webcam. Descreva em portugues o que aparece na cena, " +
  "mencionando objetos e pessoas principais, partes do corpo visiveis (maos, cabeca, bracos, pernas), " +
  "postura, expressao e cores. No maximo 2 frases, seja especifico.";

export function montarPromptDescricao(anterior?: string): string {
  const texto = anterior?.trim() ?? "";
  if (!texto) return PROMPT_DESCRICAO;
  return (
    `Voce observa um NOVO frame de uma webcam. Descricao do frame anterior: "${texto}". ` +
    "Compare com a imagem atual. Se algo mudou, descreva o que mudou ou o que e novo. " +
    "Se a cena estiver igual, NAO repita o que ja foi dito: tente enxergar detalhes adicionais " +
    "ainda nao mencionados (partes do corpo, objetos pequenos, textos, cores, nuances de postura). " +
    "Responda em portugues, no maximo 2 frases, sem se repetir."
  );
}

export function extrairBase64(imagem: string): string {
  const index = imagem.indexOf(",");
  if (index !== -1 && imagem.slice(0, index).includes(";base64")) {
    return imagem.slice(index + 1);
  }
  return imagem;
}

interface RespostaOllama {
  response?: string;
  model?: string;
  eval_count?: number;
  eval_duration?: number;
  total_duration?: number;
}

export async function gerarDescricao(
  imagem: string,
  opcoes: OpcoesGerarDescricao = {}
): Promise<ResultadoDescricao> {
  const host = (opcoes.host ?? process.env.OLLAMA_HOST ?? "http://localhost:11434").replace(/\/+$/, "");
  const modelo = opcoes.modelo ?? process.env.OLLAMA_MODEL ?? "qwen3-vl:4b";
  const prompt = opcoes.prompt ?? montarPromptDescricao(opcoes.anterior);
  const timeoutMs = opcoes.timeoutMs ?? 90_000;

  const corpo = JSON.stringify({
    model: modelo,
    prompt,
    images: [extrairBase64(imagem)],
    stream: false,
    keep_alive: "5m",
    options: { temperature: 0.2, think: false, num_predict: 140 },
  });

  const inicio = performance.now();
  const resposta = await fetch(`${host}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: corpo,
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!resposta.ok) {
    const texto = await resposta.text().catch(() => "");
    throw new Error(`Ollama respondeu ${resposta.status}: ${texto.slice(0, 300)}`);
  }

  const dados = (await resposta.json()) as RespostaOllama;
  const duracaoNs = dados.total_duration ?? (performance.now() - inicio) * 1_000_000;

  return {
    texto: dados.response ?? "",
    modelo: dados.model ?? modelo,
    tokens: dados.eval_count ?? 0,
    duracaoMs: Math.round(duracaoNs / 1_000_000),
  };
}