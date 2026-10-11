export type ModoAnalise = "descricao" | "roteiro";

export interface OpcoesGerarDescricao {
  modelo?: string;
  prompt?: string;
  host?: string;
  timeoutMs?: number;
  anterior?: string;
  modo?: ModoAnalise;
  roteiro?: string;
  base?: boolean;
  /** Cancela o fetch do Ollama (ex.: cliente desconectou do stream). */
  signal?: AbortSignal;
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

export const PROMPT_ROTEIRO_BASE =
  "Voce ve o PRIMEIRO frame de uma webcam. Faca uma descricao profunda e detalhada da cena em " +
  "portugues: pessoas, objetos, disposicao, cores, iluminacao, postura e possiveis acoes. " +
  "Escreva de 3 a 4 frases objetivas, sem repetir ideias.";

export const PROMPT_ROTEIRO_DELTA =
  "Voce acompanha uma webcam e mantem um ROTEIRO do que ja aconteceu. " +
  "Escreva em portugues APENAS o que mudou no novo frame em relacao ao roteiro, em 1 frase curta " +
  "e concreta. Nao repita o que ja foi dito. Se nada relevante mudou, responda apenas a palavra: INALTERADO.";

export function montarPromptRoteiro(base: boolean, roteiro?: string): string {
  if (base) return PROMPT_ROTEIRO_BASE;
  const texto = roteiro?.trim() ?? "";
  if (!texto) return PROMPT_ROTEIRO_DELTA;
  return (
    `${PROMPT_ROTEIRO_DELTA} Roteiro ate agora: "${texto}". ` +
    "Descreva somente a diferenca deste frame para o roteiro."
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
  error?: string;
  message?: { role?: string; content?: string; thinking?: string };
  eval_count?: number;
  eval_duration?: number;
  total_duration?: number;
  done?: boolean;
}

export const MODELO_PADRAO = "qwen2.5vl:3b";

export class ErroOllama extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroOllama";
  }
}

function resolverHost(opcoes: OpcoesGerarDescricao): string {
  return (opcoes.host ?? process.env.OLLAMA_HOST ?? "http://localhost:11434").replace(/\/+$/, "");
}

export interface OpcoesOllama {
  modelo?: string;
  host?: string;
  timeoutMs?: number;
}

function resolverModelo(opcoes: OpcoesOllama): string {
  return opcoes.modelo ?? process.env.OLLAMA_MODEL ?? MODELO_PADRAO;
}

/**
 * Normaliza o nome de um modelo do Ollama preservando a tag.
 *
 * Retirar a tag confundiria modelos diferentes com o mesmo nome base
 * (por exemplo `qwen2.5vl:3b` e `qwen2.5vl:7b`). O unico alias tratado
 * explicitamente e a ausencia de tag, que a API do Ollama interpreta como
 * `latest`.
 */
export function normalizarNomeModelo(nome: string): string {
  const texto = nome.trim();
  if (!texto) return "";
  const idx = texto.lastIndexOf(":");
  const sufixo = idx === -1 ? "" : texto.slice(idx + 1);
  // Um sufixo vazio ou com "/" nao e uma tag (pode ser uma porta de registry),
  // entao o nome e tratado como sem tag.
  if (idx === -1 || sufixo.length === 0 || sufixo.includes("/")) {
    return `${texto}:latest`;
  }
  return texto;
}

/** Compara a identidade completa de dois modelos, preservando a tag. */
export function mesmoModelo(a: string, b: string): boolean {
  const na = normalizarNomeModelo(a);
  const nb = normalizarNomeModelo(b);
  return na.length > 0 && na === nb;
}

export async function modelosEmMemoria(opcoes: OpcoesOllama = {}): Promise<string[]> {
  const host = resolverHost(opcoes as OpcoesGerarDescricao);
  try {
    const resposta = await fetch(`${host}/api/ps`, {
      signal: AbortSignal.timeout(opcoes.timeoutMs ?? 5_000),
    });
    if (!resposta.ok) return [];
    const dados = (await resposta.json()) as { models?: { name?: string; model?: string }[] };
    return (dados.models ?? [])
      .map((m) => m.name ?? m.model ?? "")
      .filter((n) => n.length > 0);
  } catch {
    return [];
  }
}

export async function modeloEmMemoria(opcoes: OpcoesOllama = {}): Promise<boolean> {
  const modelo = resolverModelo(opcoes);
  if (!normalizarNomeModelo(modelo)) return false;
  const memoria = await modelosEmMemoria(opcoes);
  return memoria.some((m) => mesmoModelo(m, modelo));
}

export async function forcarCarregamento(opcoes: OpcoesOllama = {}): Promise<number> {
  const host = resolverHost(opcoes as OpcoesGerarDescricao);
  const modelo = resolverModelo(opcoes);
  const timeoutMs = opcoes.timeoutMs ?? 180_000;
  if (await modeloEmMemoria(opcoes)) return 0;

  const inicio = performance.now();
  const corpo = JSON.stringify({
    model: modelo,
    messages: [{ role: "user", content: "oi" }],
    stream: false,
    think: false,
    keep_alive: "5m",
    options: { num_predict: 1, temperature: 0 },
  });
  const resposta = await fetch(`${host}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: corpo,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!resposta.ok) {
    const texto = await resposta.text().catch(() => "");
    throw new ErroOllama(`resposta HTTP ${resposta.status}: ${texto.slice(0, 300)}`);
  }
  await resposta.json().catch(() => null);

  for (let i = 0; i < 60; i++) {
    if (await modeloEmMemoria(opcoes)) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return Math.round(performance.now() - inicio);
}

export const NUM_PREDICT_PADRAO = 256;
export const NUM_PREDICT_BASE = 320;
export const NUM_PREDICT_DELTA = 160;

function montarCorpo(
  imagem: string,
  opcoes: OpcoesGerarDescricao,
  stream: boolean
): { modelo: string; corpo: string } {
  const modelo = opcoes.modelo ?? process.env.OLLAMA_MODEL ?? MODELO_PADRAO;
  const roteiro = opcoes.modo === "roteiro";
  const prompt =
    opcoes.prompt ??
    (roteiro ? montarPromptRoteiro(opcoes.base === true, opcoes.roteiro) : montarPromptDescricao(opcoes.anterior));
  const mensagem: { role: string; content: string; images?: string[] } = {
    role: "user",
    content: prompt,
  };
  const imagemBase64 = extrairBase64(imagem);
  if (imagemBase64) mensagem.images = [imagemBase64];
  const numPredict = roteiro
    ? opcoes.base === true
      ? NUM_PREDICT_BASE
      : NUM_PREDICT_DELTA
    : NUM_PREDICT_PADRAO;
  const corpo = JSON.stringify({
    model: modelo,
    messages: [mensagem],
    stream,
    think: false,
    keep_alive: "5m",
    options: {
      temperature: 0.2,
      repeat_penalty: 1.3,
      repeat_last_n: 128,
      top_p: 0.9,
      num_predict: numPredict,
    },
  });
  return { modelo, corpo };
}

function lancarSeVazioSemResposta(
  vistoPensamento: boolean,
  modelo: string
): never {
  if (vistoPensamento) {
    throw new ErroOllama(
      `o modelo ${modelo} derivou/raciocinou sem produzir resposta (o Ollama ignorou think:false neste modelo). ` +
        "Use um modelo de descricao nao-pensante (ex.: `ollama pull qwen2.5vl:3b` e OLLAMA_MODEL=qwen2.5vl:3b)."
    );
  }
  throw new ErroOllama("o modelo nao retornou nenhum token de texto (verifique think/num_predict)");
}

export async function gerarDescricao(
  imagem: string,
  opcoes: OpcoesGerarDescricao = {}
): Promise<ResultadoDescricao> {
  const host = resolverHost(opcoes);
  const timeoutMs = opcoes.timeoutMs ?? 90_000;
  const { modelo, corpo } = montarCorpo(imagem, opcoes, false);

  const inicio = performance.now();
  const resposta = await fetch(`${host}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: corpo,
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!resposta.ok) {
    const texto = await resposta.text().catch(() => "");
    throw new ErroOllama(`resposta HTTP ${resposta.status}: ${texto.slice(0, 300)}`);
  }

  const dados = (await resposta.json()) as RespostaOllama;
  if (dados.error) throw new ErroOllama(dados.error);
  const texto = dados.message?.content ?? dados.response ?? "";
  const pensou = Boolean(dados.message?.thinking);
  if (!texto) lancarSeVazioSemResposta(pensou, modelo);
  const duracaoNs = dados.total_duration ?? (performance.now() - inicio) * 1_000_000;

  return {
    texto,
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
  const sinais: AbortSignal[] = [AbortSignal.timeout(timeoutMs)];
  if (opcoes.signal) sinais.push(opcoes.signal);
  const resposta = await fetch(`${host}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: corpo,
    signal: AbortSignal.any(sinais),
  });

  if (!resposta.ok) {
    const texto = await resposta.text().catch(() => "");
    throw new ErroOllama(`resposta HTTP ${resposta.status}: ${texto.slice(0, 300)}`);
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
  let emitiuTexto = false;
  let pensou = false;

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
        if (evt.error) throw new ErroOllama(evt.error);
        if (evt.model) modeloFinal = evt.model;
        const texto = evt.message?.content ?? evt.response;
        if (texto) {
          emitiuTexto = true;
          yield texto;
        }
        if (evt.message?.thinking) pensou = true;
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

  if (!emitiuTexto) lancarSeVazioSemResposta(pensou, modeloFinal);
  return { modelo: modeloFinal, tokens, duracaoMs };
}