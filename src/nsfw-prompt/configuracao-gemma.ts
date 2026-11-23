/**
 * Configuração centralizada do modelo multimodal NSFW (Fase 5, plano §11).
 *
 * Antes o identificador vivia como constante em `instrucoes.ts` e era repetido
 * em texto de log/UI. Aqui ele passa a ter um único lugar tipado: o padrão
 * continua exatamente o mesmo e qualquer sobrescrita local/env é normalizada
 * antes de chegar ao cliente ou ao servidor.
 *
 * Módulo puro (sem `node:*`): o cliente importa a mesma definição sem puxar
 * `src/env.ts`, que depende de filesystem. Nenhum valor aqui é medição de
 * qualidade, latência ou memória — são apenas parâmetros declarados.
 */

export interface ConfiguracaoGemma {
  /** Identificador do modelo no backend (LM Studio). */
  modelo: string;
  /** Versão declarada do modelo; vazia quando desconhecida. */
  versao: string;
  /** Quantização declarada; vazia quando desconhecida. */
  quantizacao: string;
  /** Contexto máximo declarado; 0 quando desconhecido (não é medido). */
  contextoMaximo: number;
  /** Template de conversa declarado; vazio quando desconhecido. */
  templateConversa: string;
}

const TAMANHO_MAXIMO_TEXTO = 200;

/** Valor histórico — preservado para não trocar o modelo por acidente. */
export const MODELO_GEMMA_PADRAO = "gemma-4-e2b-uncensored-hauhaucs-aggressive";

export const CONFIGURACAO_GEMMA_PADRAO: Readonly<ConfiguracaoGemma> = Object.freeze({
  modelo: MODELO_GEMMA_PADRAO,
  versao: "",
  quantizacao: "",
  contextoMaximo: 0,
  templateConversa: "",
});

function texto(valor: unknown): string | undefined {
  if (typeof valor !== "string") return undefined;
  const limpo = valor.trim();
  return limpo !== "" ? limpo.slice(0, TAMANHO_MAXIMO_TEXTO) : undefined;
}

/**
 * Normaliza uma sobrescrita parcial. Campos ausentes/inválidos herdam o padrão;
 * nunca se aceita string vazia como identificador de modelo.
 */
export function normalizarConfiguracaoGemma(
  valor: unknown
): ConfiguracaoGemma {
  if (valor === null || typeof valor !== "object" || Array.isArray(valor)) {
    return { ...CONFIGURACAO_GEMMA_PADRAO };
  }
  const obj = valor as Record<string, unknown>;
  const contexto = obj.contextoMaximo;
  return {
    modelo: texto(obj.modelo) ?? CONFIGURACAO_GEMMA_PADRAO.modelo,
    versao: texto(obj.versao) ?? CONFIGURACAO_GEMMA_PADRAO.versao,
    quantizacao: texto(obj.quantizacao) ?? CONFIGURACAO_GEMMA_PADRAO.quantizacao,
    contextoMaximo:
      typeof contexto === "number" && Number.isFinite(contexto) && contexto > 0
        ? Math.floor(contexto)
        : CONFIGURACAO_GEMMA_PADRAO.contextoMaximo,
    templateConversa: texto(obj.templateConversa) ?? CONFIGURACAO_GEMMA_PADRAO.templateConversa,
  };
}

/** Mescla uma sobrescrita opcional com o padrão, sempre devolvendo objeto novo. */
export function resolverConfiguracaoGemma(
  sobrescrita?: Partial<ConfiguracaoGemma> | null
): ConfiguracaoGemma {
  return normalizarConfiguracaoGemma({
    ...CONFIGURACAO_GEMMA_PADRAO,
    ...(sobrescrita ?? {}),
  });
}

/** Linha curta e auditável para diagnóstico — sem prometer desempenho. */
export function descreverConfiguracaoGemma(config: ConfiguracaoGemma): string {
  const partes = [config.modelo];
  if (config.versao) partes.push(`versao ${config.versao}`);
  if (config.quantizacao) partes.push(`quantizacao ${config.quantizacao}`);
  if (config.contextoMaximo > 0) partes.push(`contexto declarado ${config.contextoMaximo}`);
  if (config.templateConversa) partes.push(`template ${config.templateConversa}`);
  return partes.join("; ");
}
