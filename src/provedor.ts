/**
 * Camada de inferencia de visao. O app fala um unico protocolo de chat,
 * compativel com a API de "chat completions" (`/v1/chat/completions`,
 * `/v1/models`), exposto pelo LM Studio e por outros servidores locais
 * equivalentes (llama.cpp `llama-server`, vLLM, ...).
 *
 * O mapeamento de requisicao/resposta fica isolado aqui; o resto do servidor
 * trata apenas o formato generico (`ResultadoChat`).
 */
import { env } from "./env";

/** URL base padrao do servidor local de visao (LM Studio). */
export const BASE_URL_PADRAO = "http://localhost:1234";

/** Backend de visao resolvido (URL base sem barra final + chave opcional). */
export interface Backend {
  /** URL base sem barra final (ex.: `http://localhost:1234`). */
  baseUrl: string;
  apiKey?: string;
}

export interface OpcoesBackend {
  /** URL base explicita (sobrepoe as variaveis de ambiente). */
  baseUrl?: string;
  apiKey?: string;
}

/** Resultado generico de um trecho (stream) ou da resposta completa de chat. */
export interface ResultadoChat {
  /** Texto produzido (trecho no stream, conteudo final na resposta completa). */
  texto?: string;
  /** Modelo que respondeu, quando informado. */
  modelo?: string;
  /** Tokens gerados ate agora, quando informado. */
  tokens?: number;
  /** Duracao total em milissegundos, quando informada. */
  duracaoMs?: number;
  /** O modelo emitiu raciocinio ("thinking"/"reasoning") neste trecho. */
  pensou?: boolean;
  /** Motivo de termino informado pelo backend ("stop", "length", ...). */
  motivoFim?: string;
  /** Indica o fim do stream. */
  done?: boolean;
  /** Erro devolvido pelo backend. */
  erro?: string;
}

function semBarra(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Resolve o backend efetivo a partir das opcoes e variaveis de ambiente.
 * `NEURO_BASE_URL` tem prioridade sobre o padrao local.
 */
export function resolverBackend(opcoes: OpcoesBackend = {}): Backend {
  const explicitada = opcoes.baseUrl ?? env.NEURO_BASE_URL;
  const baseUrl = semBarra(explicitada !== "" ? explicitada : BASE_URL_PADRAO);
  const apiKey = opcoes.apiKey ?? env.NEURO_API_KEY;
  return { baseUrl, apiKey: apiKey !== "" ? apiKey : undefined };
}

/** Separa a base da "versao" (`/v1`) de uma URL de API, evitando duplicar. */
export function raizApi(baseUrl: string): { raiz: string; versao: string } {
  const m = semBarra(baseUrl).match(/^(.*?)(\/v\d+)$/);
  return m ? { raiz: m[1], versao: m[2] } : { raiz: semBarra(baseUrl), versao: "/v1" };
}

/** URL de chat completions do backend. */
export function urlChat(backend: Backend): string {
  const { raiz, versao } = raizApi(backend.baseUrl);
  return `${raiz}${versao}/chat/completions`;
}

/** URL que lista os modelos instalados/baixados (para escolher o melhor). */
export function urlModelos(backend: Backend): string {
  const { raiz, versao } = raizApi(backend.baseUrl);
  return `${raiz}${versao}/models`;
}

/** URL que lista os modelos em memoria (REST v0 do LM Studio). */
export function urlEmMemoria(backend: Backend): string {
  const { raiz } = raizApi(backend.baseUrl);
  return `${raiz}/api/v0/models`;
}

export function cabecalhos(backend: Backend): Record<string, string> {
  const cabecalhos: Record<string, string> = { "Content-Type": "application/json" };
  if (backend.apiKey) cabecalhos.Authorization = `Bearer ${backend.apiKey}`;
  return cabecalhos;
}

/** Remove o prefixo `data:...;base64,` de uma imagem, devolvendo o base64 cru. */
export function extrairBase64(imagem: string): string {
  const index = imagem.indexOf(",");
  if (index !== -1 && imagem.slice(0, index).includes(";base64")) {
    return imagem.slice(index + 1);
  }
  return imagem;
}

/** Converte base64 cru em data URL quando necessario. */
export function paraDataUrl(imagem: string): string {
  if (imagem.startsWith("data:")) return imagem;
  return `data:image/jpeg;base64,${extrairBase64(imagem)}`;
}

/** Valor do campo `image_url.url`: data URL (padrao) ou base64 cru. */
export function urlDaImagem(imagem: string): string {
  return env.NEURO_IMG_BASE64_CRU ? extrairBase64(imagem) : paraDataUrl(imagem);
}

export interface OpcoesRequisicao {
  backend: Backend;
  modelo: string;
  prompt: string;
  /** Imagem como base64 cru ou data URL (opcional: usado tambem na traducao). */
  imagem?: string;
  /**
   * Varias imagens, na ordem em que devem ser interpretadas. Quando presente,
   * tem prioridade sobre `imagem`.
   */
  imagens?: string[];
  /**
   * Convencao de envio das imagens:
   * - `openai` (padrao): blocos `image_url` no conteudo da mensagem;
   * - `ollama`: campo `images` (base64 cru) na mensagem.
   */
  formatoImagens?: FormatoImagens;
  stream: boolean;
  /** Opcoes de amostragem (`temperature`, `top_p`, ...). */
  amostragem?: Record<string, number>;
  /** Limite de tokens da resposta. */
  numPredict?: number;
}

export type FormatoImagens = "openai" | "ollama";

export interface Requisicao {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/**
 * Monta a requisicao de chat. As imagens vao como blocos `image_url` com data
 * URL (padrao OpenAI/LM Studio) ou como campo `images` (Ollama), sempre na
 * ordem informada. `imagem` (singular) continua suportado para compatibilidade.
 */
export function montarRequisicaoChat(opcoes: OpcoesRequisicao): Requisicao {
  const { backend, modelo, prompt, stream } = opcoes;
  const url = urlChat(backend);
  const headers = cabecalhos(backend);
  const imagens = opcoes.imagens ?? (opcoes.imagem ? [opcoes.imagem] : []);
  const formato = opcoes.formatoImagens ?? "openai";

  const mensagem: Record<string, unknown> =
    imagens.length === 0
      ? { role: "user", content: prompt }
      : formato === "ollama"
        ? { role: "user", content: prompt, images: imagens.map((img) => extrairBase64(img)) }
        : {
            role: "user",
            content: [
              { type: "text", text: prompt },
              ...imagens.map((img) => ({
                type: "image_url",
                image_url: { url: urlDaImagem(img) },
              })),
            ],
          };

  const corpo: Record<string, unknown> = {
    model: modelo,
    messages: [mensagem],
    stream,
    temperature: opcoes.amostragem?.temperature ?? 0.2,
    top_p: opcoes.amostragem?.top_p ?? 0.9,
  };
  if (opcoes.numPredict !== undefined) corpo.max_tokens = opcoes.numPredict;
  if (stream && formato !== "ollama") corpo.stream_options = { include_usage: true };
  return { url, headers, body: JSON.stringify(corpo) };
}

/** Extrai texto/`reasoning` de um objeto JSON do backend, de forma tolerante. */
function conteudoTexto(conteudo: unknown): string {
  if (typeof conteudo === "string") return conteudo;
  if (Array.isArray(conteudo)) {
    return conteudo
      .map((parte) => {
        if (typeof parte === "string") return parte;
        if (parte && typeof parte === "object" && "text" in parte) {
          const t = (parte as { text?: unknown }).text;
          return typeof t === "string" ? t : "";
        }
        return "";
      })
      .join("");
  }
  return "";
}

/** Interpreta um objeto JSON recebido do backend (stream ou resposta completa). */
export function interpretarChat(json: unknown): ResultadoChat {
  if (!json || typeof json !== "object") return {};
  const obj = json as Record<string, unknown>;
  if (typeof obj.error === "string") return { erro: obj.error };

  const escolhas = Array.isArray(obj.choices) ? (obj.choices as Record<string, unknown>[]) : [];
  const primeira = escolhas[0] ?? {};
  const delta = (primeira.delta ?? {}) as Record<string, unknown>;
  const mensagem = (primeira.message ?? {}) as Record<string, unknown>;
  const texto = conteudoTexto(delta.content) || conteudoTexto(mensagem.content) || undefined;
  const uso = (obj.usage ?? {}) as Record<string, unknown>;
  const pensou =
    typeof delta.reasoning_content === "string" ||
    typeof mensagem.reasoning_content === "string" ||
    (typeof delta.reasoning === "string" && delta.reasoning.length > 0);
  return {
    texto: texto && texto.length > 0 ? texto : undefined,
    modelo: typeof obj.model === "string" ? obj.model : undefined,
    tokens: typeof uso.completion_tokens === "number" ? uso.completion_tokens : undefined,
    pensou,
    motivoFim: typeof primeira.finish_reason === "string" ? primeira.finish_reason : undefined,
    done: primeira.finish_reason !== undefined && primeira.finish_reason !== null,
  };
}

/**
 * Interpreta uma linha de stream (SSE). Retorna `null` quando a linha e vazia,
 * um comentario/keep-alive, ou o marcador `data: [DONE]`.
 */
export function interpretarLinha(linha: string): ResultadoChat | null {
  const texto = linha.trim();
  if (!texto) return null;
  // SSE: linhas "data: {...}" e o terminador "data: [DONE]".
  if (!texto.startsWith("data:")) return null;
  const dados = texto.slice(5).trim();
  if (!dados || dados === "[DONE]") return null;
  try {
    return interpretarChat(JSON.parse(dados));
  } catch {
    return null;
  }
}

/** Formato do corpo de erro de um backend, para mensagens de diagnostico. */
export function pareceErroDeImagem(msg: string): boolean {
  return /base64 encoded image|invalid image|image_url/i.test(msg);
}

export function instrucaoImagemCrua(): string {
  return (
    "O backend rejeitou a imagem como data URL. Se estiver no LM Studio, " +
    "atualize para a versao que aceita data URIs ou defina NEURO_IMG_BASE64_CRU=1."
  );
}
