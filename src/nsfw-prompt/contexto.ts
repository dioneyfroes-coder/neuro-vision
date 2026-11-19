import type { QuadroNsfwPrompt } from "./tipos";
import { INSTRUCAO_NSFW } from "./instrucoes";
import { formatarMarcacoesNsfw } from "./marcacoes";

/** Limite de caracteres do contexto declarado (metadado vindo da midia/app). */
export const LIMITE_CONTEXTO_DECLARADO = 1_000;

/**
 * Normaliza o contexto/metadado declarado: remove quebras de linha excessivas e
 * limita o tamanho. Devolve `undefined` quando nao ha texto util.
 */
export function normalizarContextoDeclarado(
  contexto: string | null | undefined
): string | undefined {
  if (typeof contexto !== "string") return undefined;
  const limpo = contexto.replace(/\s+/g, " ").trim();
  if (!limpo) return undefined;
  return limpo.slice(0, LIMITE_CONTEXTO_DECLARADO);
}

/**
 * Bloco de prompt com o **contexto declarado** por quem enviou a midia (nome do
 * arquivo, anotacao do usuario, metadado). Nao e observacao visual: serve apenas
 * para fatos declarados explicitamente, em especial identidade de genero.
 */
export function blocoContextoDeclarado(contexto: string | null | undefined): string {
  const normalizado = normalizarContextoDeclarado(contexto);
  if (!normalizado) return "";
  return [
    "CONTEXTO DECLARADO (metadado fornecido por quem enviou a midia):",
    `- ${normalizado}`,
    "",
    "Regras do contexto declarado:",
    "- Trate-o como DECLARACAO, nao como observacao visual. Nao contradiga a imagem, mas nao invente " +
      "detalhes que o contexto nao afirma.",
    "- Use identidade de genero declarada (por exemplo, 'pessoa trans', 'homem', 'mulher') somente " +
      "quando este contexto a declarar explicitamente.",
    "- Nunca deduza 'pessoa trans' de aparencia, roupa, voz, nome artistico ou comportamento. Sem " +
      "declaracao explicita, use apenas a apresentacao visual observada.",
  ].join("\n");
}

/**
 * Bloco de prompt com a instrucao NSFW e as marcacoes por imagem.
 *
 * Retorna string vazia quando nao ha quadros: quem chama decide se o bloco
 * deve existir (subsistema ativo). Um quadro sem marcacoes tambem gera bloco:
 * o modelo continua autorizado a descrever conteudo adulto que o detector nao
 * conseguiu localizar.
 *
 * `contexto` e um metadado declarado (ex.: nome do clipe), nunca uma inferencia
 * do detector. Ele e anexado antes das marcacoes para que o modelo saiba a
 * diferenca entre declaracao e evidencia.
 */
export function blocoNsfwPrompt(
  quadros: ReadonlyArray<QuadroNsfwPrompt>,
  contexto?: string | null
): string {
  if (quadros.length === 0) return "";
  const linhas = quadros.map((q) => {
    const referencia = `Imagem ${q.indice}${q.frameId ? ` (frameId ${q.frameId})` : ""}`;
    return `- ${referencia}: ${formatarMarcacoesNsfw(q.marcacoes)}`;
  });
  const contextoDeclarado = blocoContextoDeclarado(contexto);
  return [
    ...(contextoDeclarado ? [contextoDeclarado, ""] : []),
    INSTRUCAO_NSFW,
    "",
    "Marcacoes NSFW observadas (rotulo traduzido, score, caixa normalizada " +
      "[xmin,ymin,xmax,ymax], origem no canto superior esquerdo):",
    ...linhas,
    "",
    "Uma imagem sem marcacoes NAO prova ausencia de conteudo adulto; descreva o que ela mostra.",
  ].join("\n");
}
