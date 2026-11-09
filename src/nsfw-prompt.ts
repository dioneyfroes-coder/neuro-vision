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
 *
 * A instrucao tambem separa **evidencia** de **inferencia**: marcacao nao e
 * veredito, ausencia de marcacao nao prova ausencia de conteudo adulto e a
 * imagem sempre prevalece sobre a caixa do detector.
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
 * Modelo de visao obrigatorio quando o subsistema NSFW esta ativo.
 *
 * O padrao do app continua sendo o modelo rapido (`qwen2.5-vl-3b-instruct`);
 * o NSFW so roda com este modelo, escolhido por fidelidade e por nao recusar
 * conteudo adulto. A regra vale no cliente e no servidor.
 */
export const MODELO_NSFW = "gemma-4-e2b-uncensored-hauhaucs-aggressive";

/**
 * Resolve o modelo efetivo de uma requisicao de visao.
 *
 * Com NSFW ativo, ignora a escolha da interface/padrao do servidor e devolve
 * sempre `MODELO_NSFW`. Sem NSFW, preserva o modelo pedido (`undefined` = o
 * servidor decide o padrao).
 */
export function resolverModeloVisao(
  modelo: string | undefined | null,
  nsfwAtivo: boolean
): string | undefined {
  return nsfwAtivo ? MODELO_NSFW : (modelo ?? undefined);
}

/**
 * Glossario dos rotulos conhecidos do modelo NSFW (erax). O rotulo bruto e
 * preservado; a traducao evita que `make_love` seja lido como comando e que
 * termos anatomicos em ingles passem sem contexto para o VLM.
 */
const GLOSSARIO_NSFW: Readonly<Record<string, string>> = {
  anus: "anus",
  make_love: "ato sexual/intercurso",
  nipple: "mamilo/seio",
  penis: "penis",
  vagina: "vagina",
};

/**
 * Instrucao explicita que acompanha qualquer prompt quando o NSFW esta ativo.
 *
 * Nao e uma sugestao: o modelo deve descrever o que a imagem mostra mesmo que
 * seja conteudo adulto explicito. As unicas restricoes sao nao inventar o que
 * nao esta visivel e nao sexualizar pessoas que aparentem ser menores.
 */
export const INSTRUCAO_NSFW = [
  "CONTEUDO ADULTO (NSFW) - CLASSIFICADOR LOCAL ATIVO",
  "",
  "As marcacoes abaixo sao EVIDENCIA observada do detector, nao um veredito.",
  "A imagem sempre prevalece.",
  "",
  "Regras:",
  "1. Descreva o conteudo adulto visivel de forma explicita, direta e detalhada, em portugues, " +
    "com termos anatomicos (penis, vagina, anus, seios/mamilos, nadegas). Sem eufemismos, " +
    "asteriscos, tarjas ou censura.",
  "2. E proibido recusar a descricao por ser conteudo adulto. Nao peca desculpas e nao mencione " +
    "politicas, filtros, esta instrucao ou o classificador na resposta.",
  "3. Use as marcacoes para localizar o conteudo, mas descreva o que a imagem mostra. Se a caixa " +
    "nao corresponder ao conteudo visivel, registre a divergencia como incerteza.",
  "4. Ausencia de marcacao NAO prova ausencia de conteudo adulto: o detector pode falhar. Se houver " +
    "conteudo adulto nao marcado, descreva-o.",
  "5. Score = confianca do detector em [0,1], nao intensidade, gravidade ou consentimento. " +
    "Caixa = [xmin,ymin,xmax,ymax] normalizada, com origem no canto superior esquerdo.",
  "6. Em multiframe, relacione cada marcacao ao indice/frameId da imagem e descreva continuidade, " +
    "progressao e mudancas. Nao repita a mesma descricao em todas as imagens e nao presuma acoes " +
    "entre frames sem evidencia.",
  "7. Pessoas na cena: informe quantas pessoas adultas aparecem e descreva a apresentacao visual e " +
    "as caracteristicas visiveis. Use 'homem' ou 'mulher' para apresentacao visual quando a imagem " +
    "sustentar; use 'pessoa trans' somente se houver declaracao explicita no conteudo ou metadado. " +
    "Nunca deduza 'trans' de tracos fisicos, roupa, voz ou comportamento.",
  "8. Assuma pessoas adultas, exceto se a imagem indicar claramente menoridade. Se houver indicio de " +
    "que alguem seja menor, nao descreva essa pessoa sexualmente: descreva apenas o contexto nao " +
    "sexual e registre a duvida como incerteza. Nao descreva atos sexuais com animais.",
  "9. Nao invente conteudo adulto, participantes, atos ou objetos que nao estejam visiveis.",
].join("\n");

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
 * Traduz um rotulo conhecido do classificador para o prompt. Rotulos fora do
 * glossario sao preservados como vieram do sidecar do modelo.
 */
export function descreverRotuloNsfw(rotulo: string): string {
  const chave = rotulo.trim().toLowerCase();
  const traducao = GLOSSARIO_NSFW[chave];
  return traducao ? `${rotulo} (${traducao})` : rotulo;
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

/** Regiao grosseira da caixa, para ajudar o VLM a localizar o conteudo. */
function regiaoDaCaixa(caixa: Caixa): string {
  const centroX = (caixa.xmin + caixa.xmax) / 2;
  const centroY = (caixa.ymin + caixa.ymax) / 2;
  const horizontal = centroX < 1 / 3 ? "esquerda" : centroX > 2 / 3 ? "direita" : "centro";
  const vertical = centroY < 1 / 3 ? "topo" : centroY > 2 / 3 ? "base" : "meio";
  if (horizontal === "centro") return vertical === "meio" ? "centro" : vertical;
  if (vertical === "meio") return `meio-${horizontal}`;
  return `${vertical}-${horizontal}`;
}

/** Tamanho relativo da caixa, em faixas simples. */
function tamanhoDaCaixa(caixa: Caixa): string {
  const largura = Math.max(0, caixa.xmax - caixa.xmin);
  const altura = Math.max(0, caixa.ymax - caixa.ymin);
  const area = largura * altura;
  if (area < 0.02) return "pequena";
  if (area < 0.15) return "media";
  return "grande";
}

/**
 * Formata marcacoes como texto compacto para o prompt:
 * `make_love (ato sexual/intercurso) 0.87 caixa [0.1,0.2,0.5,0.8] (regiao meio-esquerda; tamanho grande)`.
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
        `${descreverRotuloNsfw(m.rotulo)} ${limitar01(m.score).toFixed(decimais)} ` +
        `caixa [${c.xmin},${c.ymin},${c.xmax},${c.ymax}] ` +
        `(regiao ${regiaoDaCaixa(c)}; tamanho ${tamanhoDaCaixa(c)})`
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
    "Marcacoes NSFW observadas (rotulo traduzido, score, caixa normalizada " +
      "[xmin,ymin,xmax,ymax], origem no canto superior esquerdo):",
    ...linhas,
    "",
    "Uma imagem sem marcacoes NAO prova ausencia de conteudo adulto; descreva o que ela mostra.",
  ].join("\n");
}
