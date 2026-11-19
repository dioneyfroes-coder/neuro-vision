import { env } from "../env";
import { resolverBackend, type Backend } from "../provedor";
import type { OpcoesGerarDescricao } from "./prompts";

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

export const TRADUZIR_HABILITADO_PADRAO = false;

export class ErroVisao extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroVisao";
  }
}

/** Resolve o backend (URL base + chave) a partir das opcoes. */
export function backendDe(opcoes: OpcoesVisao | OpcoesGerarDescricao): Backend {
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

export function modeloConfigurado(): string {
  return env.NEURO_MODEL !== "" ? env.NEURO_MODEL : MODELO_PADRAO;
}

export function resolverModelo(opcoes: OpcoesVisao): string {
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
