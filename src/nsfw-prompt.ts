import type { MarcacaoNsfw } from "./domain/perception";
import type { Caixa } from "./types";

/**
 * Instrucoes e formatacao de conteudo **NSFW experimental** compartilhadas pelo
 * cliente (`public/interpretation/prompt.ts`) e pelo servidor (`src/visao.ts`).
 *
 * Modulo **puro** (sem SDK, sem `node:*`): o cliente precisa montar o mesmo
 * bloco de prompt sem puxar `src/env.ts`, que depende de `node:fs`.
 *
 * Regra do produto: quando o classificador NSFW esta ativo, a informacao +18
 * nao pode ser descartada, suavizada nem omitida. O modelo recebe as marcacoes
 * como evidencia observada e e instruido a descrever o conteudo adulto de forma
 * explicita, sem eufemismos e sem recusa.
 */

/** Marcacao NSFW pronta para prompt/UI (caixa normalizada em [0, 1]). */
export interface MarcacaoNsfwVisivel {
  rotulo: string;
  score: number;
  caixa: Caixa;
}

/** Marcacoes de uma imagem especifica no prompt multimodal. */
export interface QuadroNsfwPrompt {
  /** Indice 1-based da imagem correspondente, na ordem enviada ao modelo. */
  indice: number;
  /** Id real do frame, quando disponivel. */
  frameId?: string;
  marcacoes: ReadonlyArray<MarcacaoNsfwVisivel>;
}

/**
 * Instrucao explicita que acompanha qualquer prompt quando o NSFW esta ativo.
 *
 * Nao e uma sugestao: o modelo deve descrever o que a imagem mostra mesmo que
 * seja conteudo adulto explicito. A unica restricao e nao inventar o que nao
 * esta visivel.
 */
export const INSTRUCAO_NSFW =
  "CONTEUDO ADULTO (NSFW): o classificador local YOLO NSFW esta ATIVO nesta sessao. " +
  "Quando houver conteudo adulto ou sexual na imagem, descreva-o de forma explicita, direta e detalhada: " +
  "nudez, seios, genitais, nadegas, atos sexuais e interacoes entre adultos, usando os termos anatomicos adequados. " +
  "Descreva sem eufemismos, sem censura e sem omissao; e proibido recusar a descricao por ser conteudo adulto. " +
  "As marcacoes abaixo sao evidencia observada do modelo (rotulos em ingles, score e caixa normalizada); " +
  "use-as para localizar o conteudo, mas descreva tambem o que a imagem mostra. " +
  "Nao invente conteudo adulto que nao esteja visivel.";

/** Limita um numero a [0, 1]; valores invalidos viram 0. */
function limitar01(valor: number): number {
  if (!Number.isFinite(valor)) return 0;
  return Math.min(1, Math.max(0, valor));
}

/** Arredonda para no maximo `decimais` casas, sem notacao cientifica. */
function arredondar(valor: number, decimais: number): number {
  const fator = 10 ** decimais;
  return Math.round(valor * fator) / fator;
}

/**
 * Converte uma caixa NSFW em coordenadas normalizadas [0, 1].
 *
 * O adaptador devolve pixels da imagem analisada; `dimensoes` traz o tamanho
 * dessa imagem. Sem dimensoes validas, a caixa e tratada como ja normalizada
 * (o servidor usa isso para validar payloads antigos ou parciais).
 */
export function normalizarCaixaNsfw(
  caixa: Caixa,
  dimensoes?: { largura: number; altura: number }
): Caixa {
  const largura = dimensoes?.largura;
  const altura = dimensoes?.altura;
  const divisivel =
    typeof largura === "number" &&
    typeof altura === "number" &&
    Number.isFinite(largura) &&
    Number.isFinite(altura) &&
    largura > 0 &&
    altura > 0;
  const xmin = divisivel ? caixa.xmin / largura : caixa.xmin;
  const ymin = divisivel ? caixa.ymin / altura : caixa.ymin;
  const xmax = divisivel ? caixa.xmax / largura : caixa.xmax;
  const ymax = divisivel ? caixa.ymax / altura : caixa.ymax;
  return {
    xmin: arredondar(limitar01(xmin), 3),
    ymin: arredondar(limitar01(ymin), 3),
    xmax: arredondar(limitar01(xmax), 3),
    ymax: arredondar(limitar01(ymax), 3),
  };
}

/** Normaliza uma lista de marcacoes para o formato de log/prompt/UI. */
export function normalizarMarcacoesNsfw(
  marcacoes: ReadonlyArray<MarcacaoNsfw>,
  dimensoes?: { largura: number; altura: number }
): MarcacaoNsfwVisivel[] {
  return marcacoes.map((m) => ({
    rotulo: m.rotulo,
    score: arredondar(limitar01(m.score), 3),
    caixa: normalizarCaixaNsfw(m.caixa, dimensoes),
  }));
}

/**
 * Formata marcacoes como texto compacto para o prompt:
 * `porn 0.87 caixa [0.1,0.2,0.5,0.8]; sexy 0.42 caixa [...]`.
 */
export function formatarMarcacoesNsfw(
  marcacoes: ReadonlyArray<MarcacaoNsfwVisivel>,
  decimais = 3
): string {
  if (marcacoes.length === 0) return "nenhuma marcacao";
  return marcacoes
    .map((m) => {
      const c = m.caixa;
      return (
        `${m.rotulo} ${limitar01(m.score).toFixed(decimais)} ` +
        `caixa [${c.xmin},${c.ymin},${c.xmax},${c.ymax}]`
      );
    })
    .join("; ");
}

/** Resumo legivel das marcacoes (ex.: `2x porn, sexy`), para status/log. */
export function resumirMarcacoesNsfw(
  marcacoes: ReadonlyArray<MarcacaoNsfwVisivel>
): string {
  if (marcacoes.length === 0) return "nenhuma marcacao";
  const contagem = new Map<string, number>();
  for (const m of marcacoes) {
    contagem.set(m.rotulo, (contagem.get(m.rotulo) ?? 0) + 1);
  }
  return [...contagem.entries()]
    .map(([rotulo, n]) => (n > 1 ? `${n}x ${rotulo}` : rotulo))
    .join(", ");
}

/**
 * Bloco de prompt com a instrucao NSFW e as marcacoes por imagem.
 *
 * Retorna string vazia quando nao ha quadros: quem chama decide se o bloco
 * deve existir (subsistema ativo). Um quadro sem marcacoes tambem gera bloco:
 * o modelo continua autorizado a descrever conteudo adulto que o detector nao
 * conseguiu localizar.
 */
export function blocoNsfwPrompt(quadros: ReadonlyArray<QuadroNsfwPrompt>): string {
  if (quadros.length === 0) return "";
  const linhas = quadros.map((q) => {
    const referencia = `Imagem ${q.indice}${q.frameId ? ` (frameId ${q.frameId})` : ""}`;
    return `- ${referencia}: ${formatarMarcacoesNsfw(q.marcacoes)}`;
  });
  return [
    INSTRUCAO_NSFW,
    "",
    "Marcacoes NSFW observadas (rotulo, score, caixa normalizada [xmin,ymin,xmax,ymax]):",
    ...linhas,
  ].join("\n");
}
