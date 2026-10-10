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
  done?: boolean;
}

const MODELO_PADRAO = "qwen3-vl:4b";

function resolverHost(opcoes: OpcoesGerarDescricao): string {
  return (opcoes.host ?? process.env.OLLAMA_HOST ?? "http://localhost:11434").replace(/\/+$/, "");
}

function montarCorpo(
  imagem: string,
  opcoes: OpcoesGerarDescricao,
  stream: boolean
): { modelo: string; corpo: string } {
  const modelo = opcoes.modelo ?? process.env.OLLAMA_MODEL ?? MODELO_PADRAO;
  const prompt = opcoes.prompt ?? montarPromptDescricao(opcoes.anterior);
  const corpo = JSON.stringify({
    model: modelo,
    prompt,
    images: [extrairBase64(imagem)],
    stream,
    keep_alive: "5m",
    options: { temperature: 0.2, think: false, num_predict: 140 },
  });
  return { modelo, corpo };
}

export async function gerarDescricao(
  imagem: string,
  opcoes: OpcoesGerarDescricao = {}
): Promise<ResultadoDescricao> {
  const host = resolverHost(opcoes);
  const timeoutMs = opcoes.timeoutMs ?? 90_000;
  const { modelo, corpo } = montarCorpo(imagem, opcoes, false);

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

export interface ResumoDescricao {
  modelo: string;
  tokens: number;
  duracaoMs: number;
}

export async function* gerarDescricaoStream(
  imagem: string,
  opcoes: OpcoesGerarDescricao = {}
): AsyncGenerator<string, ResumoDescricao, void> {
  const host = resolverHost(opcoes);
  const timeoutMs = opcoes.timeoutMs ?? 90_000;
  const { modelo, corpo } = montarCorpo(imagem, opcoes, true);

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
  if (!resposta.body) {
    throw new Error("Ollama nao retornou corpo de streaming");
  }

  const reader = resposta.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let modeloFinal = modelo;
  let tokens = 0;
  let duracaoMs = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const linha = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!linha) continue;
        let evt: RespostaOllama;
        try {
          evt = JSON.parse(linha) as RespostaOllama;
        } catch {
          continue;
        }
        if (evt.model) modeloFinal = evt.model;
        if (evt.response) yield evt.response;
        if (evt.done) {
          tokens = evt.eval_count ?? 0;
          duracaoMs = evt.total_duration
            ? Math.round(evt.total_duration / 1_000_000)
            : Math.round(performance.now() - inicio);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { modelo: modeloFinal, tokens, duracaoMs };
}