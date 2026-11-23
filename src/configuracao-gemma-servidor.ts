/**
 * Adaptador de configuração do Gemma para o servidor (Fase 5).
 *
 * `src/nsfw-prompt/configuracao-gemma.ts` é a fonte única da forma e do padrão;
 * este arquivo apenas traduz as variáveis de ambiente (que dependem de
 * `node:fs` via `env.ts`) para essa forma. Cliente e servidor continuam
 * importando os mesmos tipos e a mesma lógica de resolução.
 */
import { env } from "./env";
import {
  descreverConfiguracaoGemma,
  resolverConfiguracaoGemma,
  type ConfiguracaoGemma,
} from "./nsfw-prompt/configuracao-gemma";

export function configuracaoGemmaDoServidor(): ConfiguracaoGemma {
  return resolverConfiguracaoGemma({
    modelo: env.NEURO_MODELO_NSFW || undefined,
    versao: env.NEURO_GEMMA_VERSAO || undefined,
    quantizacao: env.NEURO_GEMMA_QUANTIZACAO || undefined,
    contextoMaximo: env.NEURO_GEMMA_CONTEXTO_MAXIMO,
    templateConversa: env.NEURO_GEMMA_TEMPLATE_CONVERSA || undefined,
  });
}

export function descricaoGemmaDoServidor(): string {
  return descreverConfiguracaoGemma(configuracaoGemmaDoServidor());
}
