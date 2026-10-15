import { env } from "./env";
import {
  cabecalhos,
  interpretarLinha,
  interpretarChat,
  montarRequisicaoChat,
  resolverBackend,
  urlEmMemoria,
  urlModelos,
  type Backend,
} from "./provedor";

export { extrairBase64 } from "./provedor";

export type ModoAnalise = "descricao" | "roteiro";

export interface OpcoesGerarDescricao {
  modelo?: string;
  prompt?: string;
  /** URL base do backend (sobrepoe `NEURO_BASE_URL`). */
  baseUrl?: string;
  timeoutMs?: number;
  modo?: ModoAnalise;
  roteiro?: string;
  base?: boolean;
  /** Cancela o fetch do backend de visao (ex.: cliente desconectou do stream). */
  signal?: AbortSignal;
  /** Chave enviada como `Authorization: Bearer` no backend. */
  apiKey?: string;
}

export interface ResultadoDescricao {
  texto: string;
  modelo: string;
  tokens: number;
  duracaoMs: number;
}

/**
 * Observacao independente: cada foto e descrita do zero, sem enviar a descricao
 * anterior. Alimentar o texto antigo faz um modelo pequeno "colar" a descricao
 * anterior em vez de olhar a imagem atual (era a principal causa da analise
 * parecer atrasada em relacao ao que estava na tela). A comparacao entre fotos
 * passa a ser feita no cliente (`diferencaDeTextos`), e nao pelo modelo.
 */
export const PROMPT_DESCRICAO =
  "Voce observa UMA foto da webcam, tirada agora. Descreva objetivamente o que aparece NESTA imagem: " +
  "pessoas, objetos (inclusive o que estiver sendo segurado ou mostrado), cores, postura e disposicao. " +
  "Baseie-se somente no que ve na imagem; nao cite fotos, descricoes ou momentos anteriores. " +
  "Responda em portugues, no maximo 2 frases.";

export function montarPromptDescricao(): string {
  return PROMPT_DESCRICAO;
}

export const PROMPT_ROTEIRO_BASE =
  "Voce ve o PRIMEIRO frame de uma webcam. Faca uma descricao profunda e detalhada da cena em " +
  "portugues: pessoas, objetos, disposicao, cores, iluminacao, postura e possiveis acoes. " +
  "Escreva de 3 a 4 frases objetivas, sem repetir ideias.";

/**
 * Delta do roteiro: continua sendo uma observacao independente da foto atual.
 * Antes o prompt mandava comparar com o roteiro acumulado e responder
 * "INALTERADO" quando nada mudasse; com um modelo 3B isso produzia oscilacao e
 * alucinacao (ex.: "a iluminacao mudou" repetido). Agora cada beat descreve so
 * o que esta na imagem, e o cliente decide se o beat repete o anterior.
 */
export const PROMPT_ROTEIRO_DELTA =
  "Voce observa UMA foto da webcam, tirada agora. Em 1 frase curta e concreta, diga o que ha NESTA " +
  "imagem (pessoas, objetos, o que estiver sendo segurado ou mostrado). " +
  "Baseie-se somente no que ve agora; nao repita nem compare com fotos anteriores.";

export function montarPromptRoteiro(base: boolean, _roteiro?: string): string {
  return base ? PROMPT_ROTEIRO_BASE : PROMPT_ROTEIRO_DELTA;
}

/**
 * Modelo de visao padrao (configuracao global). Pode ser trocado por
 * `NEURO_MODEL`; se o modelo resultante nao estiver instalado no backend,
 * `escolherModelo` cai para o melhor disponivel.
 */
export const MODELO_PADRAO = "qwen2.5-vl-3b-instruct";

/**
 * Ordem de preferencia usada quando o modelo configurado nao esta instalado.
 * Sao modelos de visao conhecidos; o primeiro prefixo que casar com um modelo
 * instalado vence. Modelos capazes vem primeiro.
 */
export const PREFERENCIA_MODELOS = [
  "qwen2.5-vl",
  "qwen2.5vl",
  "qwen3-vl",
  "qwen2-vl",
  "llama-3.2-vision",
  "llama3.2-vision",
  "llama-3.2-11b",
  "minicpm-v",
  "gemma-4",
  "gemma4",
  "gemma3",
  "llava",
  "bakllava",
];

export const MODELO_TRADUCAO_PADRAO = "";
export const TRADUZIR_HABILITADO_PADRAO = false;

export class ErroVisao extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroVisao";
  }
}

/** Resolve o backend (URL base + chave) a partir das opcoes. */
function backendDe(opcoes: OpcoesVisao | OpcoesGerarDescricao): Backend {
  return resolverBackend({
    baseUrl: opcoes.baseUrl,
    apiKey: opcoes.apiKey,
  });
}

export interface OpcoesVisao {
  modelo?: string;
  /** URL base do backend (sobrepoe `NEURO_BASE_URL`). */
  baseUrl?: string;
  timeoutMs?: number;
  apiKey?: string;
}

function modeloConfigurado(): string {
  return env.NEURO_MODEL !== "" ? env.NEURO_MODEL : MODELO_PADRAO;
}

function resolverModelo(opcoes: OpcoesVisao): string {
  return opcoes.modelo ?? modeloConfigurado();
}

/** Normaliza o nome de um modelo (remove espacos nas pontas). */
export function normalizarNomeModelo(nome: string): string {
  return nome.trim();
}

/** Compara a identidade de dois modelos, ignorando caixa e espacos. */
export function mesmoModelo(a: string, b: string): boolean {
  const na = normalizarNomeModelo(a).toLowerCase();
  const nb = normalizarNomeModelo(b).toLowerCase();
  return na.length > 0 && na === nb;
}

/**
 * Escolhe o "melhor" modelo entre os instalados segundo `PREFERENCIA_MODELOS`.
 * Se nenhum prefixo conhecido casar, devolve o primeiro da lista (melhor
 * esforco) e, se a lista estiver vazia, devolve string vazia.
 */
export function melhorModeloDisponivel(instalados: string[]): string {
  if (instalados.length === 0) return "";
  for (const prefixo of PREFERENCIA_MODELOS) {
    const achado = instalados.find((nome) =>
      normalizarNomeModelo(nome).toLowerCase().startsWith(prefixo)
    );
    if (achado) return achado;
  }
  return instalados[0];
}

/** Lista os modelos instalados/baixados no backend. */
export async function modelosInstalados(opcoes: OpcoesVisao = {}): Promise<string[]> {
  const backend = backendDe(opcoes);
  try {
    const resposta = await fetch(urlModelos(backend), {
      headers: cabecalhos(backend),
      signal: AbortSignal.timeout(opcoes.timeoutMs ?? 5_000),
    });
    if (!resposta.ok) return [];
    const dados = (await resposta.json()) as {
      data?: { id?: string }[];
      models?: { id?: string }[];
    };
    const nomes = (dados.data ?? dados.models ?? []).map((m) => m.id ?? "");
    return nomes.filter((n) => n.length > 0);
  } catch {
    return [];
  }
}

export interface ModeloEscolhido {
  /** Modelo configurado (`NEURO_MODEL` ou `MODELO_PADRAO`). */
  solicitado: string;
  /** Modelo efetivamente usado (pode ser o melhor disponivel). */
  modelo: string;
  /** `true` quando o solicitado nao estava instalado e houve substituicao. */
  alternativo: boolean;
}

const CACHE_MODELO_MS = 30_000;
let cacheModelo: { chave: string; valor: ModeloEscolhido; expira: number } | null = null;

/** Descarta a cache de escolha de modelo (usado em testes). */
export function limparCacheModelo(): void {
  cacheModelo = null;
}

/**
 * Resolve o modelo efetivo: usa o configurado quando instalado; se nao estiver
 * (e o backend responder com a lista), escolhe o melhor disponivel. Um modelo
 * passado explicitamente em `opcoes.modelo` e sempre respeitado, sem fallback.
 */
export async function escolherModelo(opcoes: OpcoesVisao = {}): Promise<ModeloEscolhido> {
  const solicitado = resolverModelo(opcoes);
  if (opcoes.modelo) return { solicitado, modelo: solicitado, alternativo: false };

  const backend = backendDe(opcoes);
  const chave = `${backend.baseUrl}|${solicitado}`;
  const agora = Date.now();
  if (cacheModelo && cacheModelo.chave === chave && cacheModelo.expira > agora) {
    return cacheModelo.valor;
  }

  const instalados = await modelosInstalados(opcoes);
  let valor: ModeloEscolhido = { solicitado, modelo: solicitado, alternativo: false };
  if (instalados.length > 0 && !instalados.some((m) => mesmoModelo(m, solicitado))) {
    const melhor = melhorModeloDisponivel(instalados);
    if (melhor) valor = { solicitado, modelo: melhor, alternativo: true };
  }
  cacheModelo = { chave, valor, expira: agora + CACHE_MODELO_MS };
  return valor;
}

export interface OpcoesTraduzir {
  texto: string;
  baseUrl?: string;
  timeoutMs?: number;
  modelo?: string;
  apiKey?: string;
}

/**
 * Traduz um texto para portugues usando o backend configurado. Desabilitado por
 * padrao (`TRADUZIR_HABILITADO_PADRAO = false`): com um modelo de visao capaz
 * (ex.: llama vision), a descricao ja sai em portugues e a traducao nao e
 * necessaria. Habilite com `NEURO_TRANSLATE_ENABLED=1`.
 */
export async function traduzirTexto(opcoes: OpcoesTraduzir): Promise<string> {
  const backend = backendDe(opcoes);
  const modeloTraduzir = env.NEURO_TRANSLATE_MODEL;
  const modelo = opcoes.modelo || (modeloTraduzir !== "" ? modeloTraduzir : resolverModelo(opcoes));
  const texto = opcoes.texto.trim();
  if (!texto) return texto;

  const prompt =
    "You are a professional English to Brazilian Portuguese translator. Translate accurately preserving meaning and nuance. " +
    "Only output the Portuguese translation, no explanations. " +
    `Text: ${texto}`;

  const requisicao = montarRequisicaoChat({
    backend,
    modelo,
    prompt,
    stream: false,
    numPredict: 256,
    amostragem: { temperature: 0, top_p: 0.9 },
  });

  try {
    const resposta = await fetch(requisicao.url, {
      method: "POST",
      headers: requisicao.headers,
      body: requisicao.body,
      signal: AbortSignal.timeout(opcoes.timeoutMs ?? 60_000),
    });
    if (!resposta.ok) return texto;
    const dados = await resposta.json();
    const traduzido = (interpretarChat(dados).texto ?? "").trim();
    return traduzido.length > 0 ? traduzido : texto;
  } catch {
    return texto;
  }
}

function traducaoHabilitada(): boolean {
  return env.NEURO_TRANSLATE_ENABLED || TRADUZIR_HABILITADO_PADRAO;
}

export function deveTraduzir(texto: string, habilitado?: boolean): boolean {
  const flag = habilitado ?? traducaoHabilitada();
  if (!flag) return false;
  if (!texto.trim()) return false;
  const lower = texto.toLowerCase();
  const padroesIngles = / (the|a|an|and|or|of|to|in|on|is|are|was|were|this|that|these|those|has|have|with|for|from|into|about|over|under|behind|between|through|people|person|object|objects|background|table|chair|door|window|room|wall|floor|ceiling|light|lights|color|colors|red|blue|green|yellow|black|white|gray|grey|man|woman|men|women|child|children|hand|hands|head|arm|arms|leg|legs|body|face|shirt|jacket|glasses|phone|cell|car|cars|truck|bike|bicycle|tree|trees|sky|grass|building|buildings|computer|laptop|book|books|cup|bottle|dog|cat|bird|camera|webcam|frame|image|scene) /;
  return padroesIngles.test(` ${lower} `);
}

export async function modelosEmMemoria(opcoes: OpcoesVisao = {}): Promise<string[]> {
  const backend = backendDe(opcoes);
  const url = urlEmMemoria(backend);
  try {
    const resposta = await fetch(url, {
      headers: cabecalhos(backend),
      signal: AbortSignal.timeout(opcoes.timeoutMs ?? 5_000),
    });
    if (!resposta.ok) return [];
    const dados = (await resposta.json()) as {
      data?: { id?: string; state?: string }[];
      models?: { id?: string; state?: string }[];
    };
    // LM Studio (REST v0): so considera "em memoria" os `state: loaded`.
    return (dados.data ?? dados.models ?? [])
      .filter((m) => m.state === undefined || m.state === "loaded")
      .map((m) => m.id ?? "")
      .filter((n) => n.length > 0);
  } catch {
    return [];
  }
}

export async function modeloEmMemoria(opcoes: OpcoesVisao = {}): Promise<boolean> {
  const modelo = resolverModelo(opcoes);
  if (!normalizarNomeModelo(modelo)) return false;
  const memoria = await modelosEmMemoria(opcoes);
  return memoria.some((m) => mesmoModelo(m, modelo));
}

/**
 * Indica se o backend permite consultar o que esta em memoria. Tentamos o REST
 * v0 do LM Studio (`/api/v0/models`), que pode nao existir em outras
 * implementacoes. Quando nao ha como confirmar, tratamos a carga bem-sucedida
 * como suficiente.
 */
export async function memoriaIntrospectavel(opcoes: OpcoesVisao = {}): Promise<boolean> {
  const backend = backendDe(opcoes);
  const url = urlEmMemoria(backend);
  try {
    const resposta = await fetch(url, {
      headers: cabecalhos(backend),
      signal: AbortSignal.timeout(opcoes.timeoutMs ?? 5_000),
    });
    return resposta.ok;
  } catch {
    return false;
  }
}

export async function forcarCarregamento(opcoes: OpcoesVisao = {}): Promise<number> {
  const backend = backendDe(opcoes);
  const modelo = resolverModelo(opcoes);
  const timeoutMs = opcoes.timeoutMs ?? 180_000;
  if (await modeloEmMemoria(opcoes)) return 0;

  const inicio = performance.now();
  const requisicao = montarRequisicaoChat({
    backend,
    modelo,
    prompt: "oi",
    stream: false,
    numPredict: 1,
    amostragem: { temperature: 0 },
  });
  const resposta = await fetch(requisicao.url, {
    method: "POST",
    headers: requisicao.headers,
    body: requisicao.body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!resposta.ok) {
    const texto = await resposta.text().catch(() => "");
    throw new ErroVisao(`resposta HTTP ${resposta.status}: ${texto.slice(0, 300)}`);
  }
  await resposta.json().catch(() => null);

  // So espera confirmacao em memoria se o backend permite consulta-la; caso
  // contrario (ex.: LM Studio sem `/api/v0/models`), a resposta acima ja
  // prova que o modelo esta carregado.
  if (await memoriaIntrospectavel(opcoes)) {
    for (let i = 0; i < 60; i++) {
      if (await modeloEmMemoria(opcoes)) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  return Math.round(performance.now() - inicio);
}

// Teto de tokens gerados por analise. E um *teto*: modelos que terminam antes
// (a maioria dos nao-pensantes) param no fim de frase e nao pagam nada por ele.
// Os valores cobrem modelos de raciocinio, que gastam ~200-300 tokens pensando
// antes de escrever a resposta — com teto pequeno o `content` sai vazio e a
// analise falha mesmo o modelo estando correto.
export const NUM_PREDICT_PADRAO = 768;
export const NUM_PREDICT_BASE = 768;
export const NUM_PREDICT_DELTA = 512;

function montarCorpo(
  imagem: string,
  opcoes: OpcoesGerarDescricao,
  stream: boolean
): { modelo: string; backend: Backend; requisicao: ReturnType<typeof montarRequisicaoChat> } {
  const modelo = resolverModelo(opcoes);
  const backend = backendDe(opcoes);
  const roteiro = opcoes.modo === "roteiro";
  const prompt =
    opcoes.prompt ??
    (roteiro ? montarPromptRoteiro(opcoes.base === true, opcoes.roteiro) : montarPromptDescricao());
  const numPredict = roteiro
    ? opcoes.base === true
      ? NUM_PREDICT_BASE
      : NUM_PREDICT_DELTA
    : NUM_PREDICT_PADRAO;
  const requisicao = montarRequisicaoChat({
    backend,
    modelo,
    prompt,
    imagem,
    stream,
    numPredict,
    amostragem: {
      temperature: 0.2,
      top_p: 0.9,
    },
  });
  return { modelo, backend, requisicao };
}

function lancarSeVazioSemResposta(
  vistoPensamento: boolean,
  modelo: string,
  motivoFim?: string
): never {
  if (vistoPensamento) {
    const dica =
      motivoFim === "length"
        ? `o modelo gastou o limite de tokens (NUM_PREDICT_PADRAO=${NUM_PREDICT_PADRAO}) ` +
          "raciocinando; aumente o limite ou use um modelo de visao nao-pensante (ex.: qwen2.5-vl)."
        : 'o backend ignorou o desligamento do "thinking"; use um modelo de visao nao-pensante (ex.: qwen2.5-vl).';
    throw new ErroVisao(`o modelo ${modelo} derivou/raciocinou sem produzir resposta: ${dica}`);
  }
  throw new ErroVisao(
    `o modelo ${modelo} nao retornou nenhum token de texto. ` +
      "Verifique se o modelo carregado no LM Studio aceita imagens (e o `max_tokens`)."
  );
}

export async function gerarDescricao(
  imagem: string,
  opcoes: OpcoesGerarDescricao = {}
): Promise<ResultadoDescricao> {
  const timeoutMs = opcoes.timeoutMs ?? 90_000;
  const { modelo, requisicao } = montarCorpo(imagem, opcoes, false);

  const inicio = performance.now();
  const resposta = await fetch(requisicao.url, {
    method: "POST",
    headers: requisicao.headers,
    body: requisicao.body,
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!resposta.ok) {
    const texto = await resposta.text().catch(() => "");
    throw new ErroVisao(`resposta HTTP ${resposta.status}: ${texto.slice(0, 300)}`);
  }

  const dados = await resposta.json();
  const evt = interpretarChat(dados);
  if (evt.erro) throw new ErroVisao(evt.erro);
  const texto = evt.texto ?? "";
  if (!texto) lancarSeVazioSemResposta(Boolean(evt.pensou), modelo, evt.motivoFim);
  const duracaoMs = evt.duracaoMs ?? Math.round(performance.now() - inicio);

  return {
    texto,
    modelo: evt.modelo ?? modelo,
    tokens: evt.tokens ?? 0,
    duracaoMs,
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
  const timeoutMs = opcoes.timeoutMs ?? 90_000;
  const { modelo, requisicao } = montarCorpo(imagem, opcoes, true);

  const inicio = performance.now();
  const sinais: AbortSignal[] = [AbortSignal.timeout(timeoutMs)];
  if (opcoes.signal) sinais.push(opcoes.signal);
  const resposta = await fetch(requisicao.url, {
    method: "POST",
    headers: requisicao.headers,
    body: requisicao.body,
    signal: AbortSignal.any(sinais),
  });

  if (!resposta.ok) {
    const texto = await resposta.text().catch(() => "");
    throw new ErroVisao(`resposta HTTP ${resposta.status}: ${texto.slice(0, 300)}`);
  }
  if (!resposta.body) {
    throw new Error("o backend de visao nao retornou corpo de streaming");
  }

  const reader = resposta.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let modeloFinal = modelo;
  let tokens = 0;
  let duracaoMs = 0;
  let emitiuTexto = false;
  let pensou = false;
  let motivoFim: string | undefined;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const linha = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        const evt = interpretarLinha(linha);
        if (!evt) continue;
        if (evt.erro) throw new ErroVisao(evt.erro);
        if (evt.modelo) modeloFinal = evt.modelo;
        if (evt.texto) {
          emitiuTexto = true;
          yield evt.texto;
        }
        if (evt.pensou) pensou = true;
        if (evt.motivoFim) motivoFim = evt.motivoFim;
        if (evt.tokens !== undefined) tokens = evt.tokens;
        if (evt.done) {
          duracaoMs = evt.duracaoMs ?? Math.round(performance.now() - inicio);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!emitiuTexto) lancarSeVazioSemResposta(pensou, modeloFinal, motivoFim);
  return { modelo: modeloFinal, tokens, duracaoMs };
}
