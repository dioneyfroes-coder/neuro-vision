/**
 * Camada de backend de inferencia. O app fala dois protocolos:
 *
 * - `ollama`: API nativa (`/api/chat`, `/api/tags`, `/api/ps`).
 * - `openai`: API compatível com OpenAI (`/v1/chat/completions`, `/v1/models`),
 *   usada por LM Studio, llama.cpp (`llama-server`), vLLM, etc. O LM Studio
 *   **nao** expoe a API nativa do Ollama, por isso o suporte a este protocolo.
 *
 * O mapeamento de requisicao/resposta fica isolado aqui; o resto do servidor
 * trata apenas o formato generico (`ResultadoChat`).
 */
import { env } from "./env";

export type ProvedorId = "ollama" | "openai";

export interface Backend {
  id: ProvedorId;
  /** URL base sem barra final (ex.: `http://localhost:11434` ou `http://localhost:1234`). */
  baseUrl: string;
  apiKey?: string;
}

export interface OpcoesBackend {
  provedor?: ProvedorId | "auto";
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
  /** Indica o fim do stream. */
  done?: boolean;
  /** Erro devolvido pelo backend. */
  erro?: string;
}

function semBarra(url: string): string {
  return url.replace(/\/+$/, "");
}

let provedorDetectado: ProvedorId | null = null;

/** Fixa o provedor detectado na subida (usado quando `NEURO_PROVIDER=auto`). */
export function definirProvedorDetectado(id: ProvedorId | null): void {
  provedorDetectado = id;
}

/** Provedor configurado por ambiente. `auto` usa o detectado na subida. */
export function provedorConfigurado(): ProvedorId {
  const valor = (env.NEURO_PROVIDER || "").toLowerCase();
  if (valor === "openai" || valor === "lmstudio" || valor === "lm-studio") return "openai";
  if (valor === "ollama") return "ollama";
  return provedorDetectado ?? "ollama";
}

export function modoAuto(): boolean {
  const valor = (env.NEURO_PROVIDER || "auto").toLowerCase();
  return valor === "auto" || valor === "";
}

/** Testa se um endpoint responde (para deteccao de provedor na subida). */
async function alcanca(url: string, backend: Backend): Promise<boolean> {
  try {
    const resposta = await fetch(url, {
      headers: cabecalhos(backend),
      signal: AbortSignal.timeout(1500),
    });
    return resposta.ok;
  } catch {
    return false;
  }
}

/**
 * Detecta qual backend esta no ar: tenta o Ollama (`/api/tags`) e, em seguida,
 * o LM Studio/OpenAI (`/v1/models`). Sem nenhum disponivel, mantem o Ollama.
 */
export async function detectarProvedor(): Promise<ProvedorId> {
  const ollama = resolverBackend({ provedor: "ollama" });
  if (await alcanca(urlModelos(ollama), ollama)) return "ollama";
  const openai = resolverBackend({ provedor: "openai" });
  if (await alcanca(urlModelos(openai), openai)) return "openai";
  return "ollama";
}

const ehAuto = (valor?: string): boolean => (valor ?? "").toLowerCase() === "auto";

/**
 * Resolve o backend efetivo a partir das opcoes e variaveis de ambiente.
 * `NEURO_BASE_URL` tem prioridade sobre os defaults de cada provedor.
 */
export function resolverBackend(opcoes: OpcoesBackend = {}): Backend {
  const id =
    opcoes.provedor && !ehAuto(opcoes.provedor)
      ? (opcoes.provedor as ProvedorId)
      : provedorConfigurado();
  const explicitada = opcoes.baseUrl ?? env.NEURO_BASE_URL;
  const baseUrl = semBarra(
    explicitada !== "" ? explicitada : id === "openai" ? env.OPENAI_BASE_URL : env.OLLAMA_HOST
  );
  const apiKey = opcoes.apiKey ?? (env.NEURO_API_KEY !== "" ? env.NEURO_API_KEY : env.OPENAI_API_KEY);
  return { id, baseUrl, apiKey };
}

/** Separa a base da "versao" (`/v1`) de uma URL OpenAI, evitando duplicar. */
export function raizOpenAI(baseUrl: string): { raiz: string; versao: string } {
  const m = semBarra(baseUrl).match(/^(.*?)(\/v\d+)$/);
  return m ? { raiz: m[1], versao: m[2] } : { raiz: semBarra(baseUrl), versao: "/v1" };
}

export function urlChat(backend: Backend): string {
  if (backend.id === "ollama") return `${backend.baseUrl}/api/chat`;
  const { raiz, versao } = raizOpenAI(backend.baseUrl);
  return `${raiz}${versao}/chat/completions`;
}

/** URL que lista os modelos instalados/baixados (para escolher o melhor). */
export function urlModelos(backend: Backend): string {
  if (backend.id === "ollama") return `${backend.baseUrl}/api/tags`;
  const { raiz, versao } = raizOpenAI(backend.baseUrl);
  return `${raiz}${versao}/models`;
}

/** URL que lista os modelos em memoria. Best-effort: OpenAI devolve `null`. */
export function urlEmMemoria(backend: Backend): string | null {
  if (backend.id === "ollama") return `${backend.baseUrl}/api/ps`;
  // LM Studio (REST v0) informa `state` ("loaded"/"not-loaded") por modelo.
  const { raiz } = raizOpenAI(backend.baseUrl);
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

/** Converte base64 cru em data URL quando necessario (protocolo OpenAI). */
export function paraDataUrl(imagem: string): string {
  if (imagem.startsWith("data:")) return imagem;
  return `data:image/jpeg;base64,${extrairBase64(imagem)}`;
}

/** Valor do campo `image_url.url`: data URL (padrao OpenAI) ou base64 cru. */
export function urlDaImagem(imagem: string): string {
  return env.NEURO_IMG_BASE64_CRU ? extrairBase64(imagem) : paraDataUrl(imagem);
}

export interface OpcoesRequisicao {
  backend: Backend;
  modelo: string;
  prompt: string;
  /** Imagem como base64 cru ou data URL (opcional: usado tambem na traducao). */
  imagem?: string;
  stream: boolean;
  /** Opcoes de amostragem especificas do provedor Ollama. */
  opcoesOllama?: Record<string, number>;
  /** Limite de tokens da resposta. */
  numPredict?: number;
  /** `keep_alive` do Ollama (ignorado no protocolo OpenAI). */
  keepAlive?: string;
}

export interface Requisicao {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/**
 * Monta a requisicao de chat para o backend. O formato do corpo muda por
 * provedor: o Ollama usa `messages[].images`, o OpenAI usa blocos de conteudo
 * `image_url` com data URL.
 */
export function montarRequisicaoChat(opcoes: OpcoesRequisicao): Requisicao {
  const { backend, modelo, prompt, imagem, stream } = opcoes;
  const url = urlChat(backend);
  const headers = cabecalhos(backend);

  if (backend.id === "ollama") {
    const mensagem: { role: string; content: string; images?: string[] } = {
      role: "user",
      content: prompt,
    };
    const b64 = imagem ? extrairBase64(imagem) : "";
    if (b64) mensagem.images = [b64];
    const options = { ...(opcoes.opcoesOllama ?? {}) };
    if (opcoes.numPredict !== undefined) options.num_predict = opcoes.numPredict;
    const body = JSON.stringify({
      model: modelo,
      messages: [mensagem],
      stream,
      think: false,
      keep_alive: opcoes.keepAlive ?? "5m",
      options,
    });
    return { url, headers, body };
  }

  const conteudo: unknown = imagem
    ? [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: urlDaImagem(imagem) } },
      ]
    : prompt;
  const corpo: Record<string, unknown> = {
    model: modelo,
    messages: [{ role: "user", content: conteudo }],
    stream,
    temperature: opcoes.opcoesOllama?.temperature ?? 0.2,
    top_p: opcoes.opcoesOllama?.top_p ?? 0.9,
  };
  if (opcoes.numPredict !== undefined) corpo.max_tokens = opcoes.numPredict;
  if (stream) corpo.stream_options = { include_usage: true };
  return { url, headers, body: JSON.stringify(corpo) };
}

/** Extrai texto/`reasoning` de um objeto JSON de um provedor, de forma tolerante. */
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
export function interpretarChat(backend: Backend, json: unknown): ResultadoChat {
  if (!json || typeof json !== "object") return {};
  const obj = json as Record<string, unknown>;
  if (typeof obj.error === "string") return { erro: obj.error };
  if (backend.id === "ollama") {
    const mensagem = (obj.message ?? {}) as { content?: unknown; thinking?: unknown };
    const texto = typeof mensagem.content === "string"
      ? mensagem.content
      : typeof obj.response === "string"
        ? obj.response
        : undefined;
    return {
      texto,
      modelo: typeof obj.model === "string" ? obj.model : undefined,
      tokens: typeof obj.eval_count === "number" ? obj.eval_count : undefined,
      duracaoMs: typeof obj.total_duration === "number"
        ? Math.round(obj.total_duration / 1_000_000)
        : undefined,
      pensou: typeof mensagem.thinking === "string" && mensagem.thinking.length > 0,
      done: obj.done === true,
    };
  }

  const escolhas = Array.isArray(obj.choices) ? (obj.choices as Record<string, unknown>[]) : [];
  const primeira = escolhas[0] ?? {};
  const delta = (primeira.delta ?? {}) as Record<string, unknown>;
  const mensagem = (primeira.message ?? {}) as Record<string, unknown>;
  const texto =
    conteudoTexto(delta.content) || conteudoTexto(mensagem.content) || undefined;
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
    done: primeira.finish_reason !== undefined && primeira.finish_reason !== null,
  };
}

/**
 * Interpreta uma linha de stream. Retorna `null` quando a linha e vazia, um
 * comentario/keep-alive, ou o marcador `[DONE]`.
 */
export function interpretarLinha(backend: Backend, linha: string): ResultadoChat | null {
  const texto = linha.trim();
  if (!texto) return null;
  if (backend.id === "ollama") {
    if (texto.startsWith(":")) return null;
    try {
      return interpretarChat(backend, JSON.parse(texto));
    } catch {
      return null;
    }
  }
  // SSE: linhas "data: {...}" e o terminador "data: [DONE]".
  if (!texto.startsWith("data:")) return null;
  const dados = texto.slice(5).trim();
  if (!dados || dados === "[DONE]") return null;
  try {
    return interpretarChat(backend, JSON.parse(dados));
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
