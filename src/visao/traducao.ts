import { env } from "../env";
import { interpretarChat, montarRequisicaoChat } from "../provedor";
import {
  TRADUZIR_HABILITADO_PADRAO,
  backendDe,
  resolverModelo,
} from "./comum";

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
