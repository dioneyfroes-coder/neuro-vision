import type { MarcacaoNsfw } from "../domain/perception";
import type { Caixa } from "../types";
import type { MarcacaoNsfwVisivel } from "./tipos";

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
 * Glossario dos rotulos conhecidos do modelo NSFW. O rotulo bruto e preservado;
 * a traducao evita que `make_love` seja lido como comando e que termos
 * anatomicos em ingles passem sem contexto para o VLM. Cobre o EraX (minusculo)
 * e o NudeNet v3.4 (MAIUSCULO; a busca normaliza para minusculo).
 */
const GLOSSARIO_NSFW: Readonly<Record<string, string>> = {
  anus: "anus",
  make_love: "ato sexual/intercurso",
  nipple: "mamilo/seio",
  penis: "penis",
  vagina: "vagina",
  // NudeNet v3.4
  female_genitalia_covered: "genitalia feminina coberta (calcinha/roupa)",
  female_genitalia_exposed: "genitalia feminina exposta",
  male_genitalia_exposed: "genitalia masculina exposta (penis)",
  anus_exposed: "anus exposto",
  anus_covered: "anus coberto",
  buttocks_exposed: "nadegas expostas",
  buttocks_covered: "nadegas cobertas",
  female_breast_exposed: "seios expostos",
  female_breast_covered: "seios cobertos",
  male_breast_exposed: "peitoral masculino exposto",
};

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
    ...(m.modelo ? { modelo: m.modelo } : {}),
    ...(m.modelos?.length ? { modelos: [...m.modelos] } : {}),
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

/** Origem de uma marcacao quando o resultado vem do conjunto multi-modelo. */
function origemDaMarcacao(m: MarcacaoNsfwVisivel): string {
  const modelos = m.modelos?.length ? m.modelos : m.modelo ? [m.modelo] : [];
  if (modelos.length === 0) return "";
  if (modelos.length === 1) return ` (modelo ${modelos[0]})`;
  return ` (concordam ${modelos.join(", ")})`;
}

/**
 * Formata marcacoes como texto compacto para o prompt:
 * `make_love (ato sexual/intercurso) 0.87 caixa [0.1,0.2,0.5,0.8] (regiao meio-esquerda; tamanho grande)`.
 *
 * Quando a marcacao vem do conjunto, a origem entra no fim — um rotulo apoiado
 * por dois detectores independentes e evidencia mais forte que um so.
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
        `(regiao ${regiaoDaCaixa(c)}; tamanho ${tamanhoDaCaixa(c)})` +
        origemDaMarcacao(m)
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
