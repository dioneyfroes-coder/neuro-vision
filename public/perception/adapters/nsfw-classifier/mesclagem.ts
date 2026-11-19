import type { MarcacaoNsfw } from "../../../../src/domain/perception";

/** IoU entre duas caixas no mesmo espaco de coordenadas. */
function iouCaixas(a: MarcacaoNsfw["caixa"], b: MarcacaoNsfw["caixa"]): number {
  const x1 = Math.max(a.xmin, b.xmin);
  const y1 = Math.max(a.ymin, b.ymin);
  const x2 = Math.min(a.xmax, b.xmax);
  const y2 = Math.min(a.ymax, b.ymax);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = Math.max(0, a.xmax - a.xmin) * Math.max(0, a.ymax - a.ymin);
  const areaB = Math.max(0, b.xmax - b.xmin) * Math.max(0, b.ymax - b.ymin);
  return inter / (areaA + areaB - inter + 1e-9);
}

/**
 * IoU minimo para considerar que dois modelos marcaram a **mesma regiao**.
 * Abaixo disso sao regioes distintas e ambas permanecem.
 */
export const LIMITE_IOU_MESCLA_NSFW = 0.6;

/**
 * Mescla marcacoes de varios modelos no mesmo frame.
 *
 * Regra: mesmo `rotulo` e caixas com IoU >= `LIMITE_IOU_MESCLA_NSFW` sao a mesma
 * evidencia. Fica a de **maior score** e os modelos que concordaram sao
 * registrados em `modelos` — a evidencia fica mais forte quando dois detectores
 * independentes apontam a mesma regiao. Rotulos diferentes nunca se suprimem:
 * os modelos sao complementares, nao redundantes.
 */
export function mesclarMarcacoesNsfw(
  marcacoes: ReadonlyArray<MarcacaoNsfw>
): MarcacaoNsfw[] {
  const ordenadas = [...marcacoes].sort(
    (a, b) => b.score - a.score || a.rotulo.localeCompare(b.rotulo)
  );
  const saida: MarcacaoNsfw[] = [];
  for (const marcacao of ordenadas) {
    const existente = saida.find(
      (m) =>
        m.rotulo === marcacao.rotulo &&
        iouCaixas(m.caixa, marcacao.caixa) >= LIMITE_IOU_MESCLA_NSFW
    );
    if (existente) {
      const modelos = new Set([
        ...(existente.modelos ?? []),
        ...(marcacao.modelos ?? (marcacao.modelo ? [marcacao.modelo] : [])),
      ]);
      existente.modelos = [...modelos];
      continue;
    }
    const modelos = marcacao.modelos ?? (marcacao.modelo ? [marcacao.modelo] : undefined);
    saida.push({ ...marcacao, ...(modelos ? { modelos: [...modelos] } : {}) });
  }
  return saida;
}
