import type { Ponto2D } from "../suavizador";
import type { AmostraInteracao, CaixaNormalizada } from "./tipos";

export function chavePar(amostra: AmostraInteracao): string {
  return chaveParIds(amostra.maoEntidadeId, amostra.objetoEntidadeId);
}

export function chaveParIds(mao: string, objeto: string): string {
  return `${mao}|${objeto}`;
}

export function centroDaCaixa(caixa: CaixaNormalizada): Ponto2D {
  return {
    x: (caixa.xmin + caixa.xmax) / 2,
    y: (caixa.ymin + caixa.ymax) / 2,
  };
}

/** `true` quando o punho esta dentro da caixa (com margem opcional). */
export function pontoNaCaixa(
  ponto: Ponto2D,
  caixa: CaixaNormalizada,
  margem: number
): boolean {
  return (
    ponto.x >= caixa.xmin - margem &&
    ponto.x <= caixa.xmax + margem &&
    ponto.y >= caixa.ymin - margem &&
    ponto.y <= caixa.ymax + margem
  );
}

export function arredondar(valor: number, casas = 3): number {
  const fator = 10 ** casas;
  return Math.round(valor * fator) / fator;
}
