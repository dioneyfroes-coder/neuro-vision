/**
 * Composição determinística de blocos de prompt (Fase 5, plano §10.2/§10.5).
 *
 * Remove apenas **duplicatas exatas de linha** e aplica um teto de caracteres
 * quando fornecido. Não reescreve instruções, não sinonimiza e não mede tokens:
 * a contagem exata continua sendo do backend. O comportamento padrão (sem
 * duplicatas e sem teto) preserva o texto anterior byte a byte.
 */

export interface OpcoesComposicaoPrompt {
  /** Teto de caracteres do texto final; `undefined` desativa o corte. */
  maxCaracteres?: number;
}

export interface ResultadoComposicaoPrompt {
  prompt: string;
  /** Quantidade de linhas repetidas removidas. */
  linhasDuplicadas: number;
  /** `true` quando o teto foi aplicado. */
  cortado: boolean;
}

/**
 * Remove linhas não vazias repetidas preservando linhas em branco e a ordem.
 * Usado pelo prompt interpretativo: quando não há repetição o texto é idêntico.
 */
export function deduparLinhasPrompt(
  linhas: ReadonlyArray<string>
): { linhas: string[]; duplicadas: number } {
  const vistas = new Set<string>();
  const resultado: string[] = [];
  let duplicadas = 0;
  for (const linha of linhas) {
    if (linha.trim() === "") {
      resultado.push(linha);
      continue;
    }
    if (vistas.has(linha)) {
      duplicadas += 1;
      continue;
    }
    vistas.add(linha);
    resultado.push(linha);
  }
  return { linhas: resultado, duplicadas };
}

/** Junta blocos com linha em branco, remove repetições e aplica o teto. */
export function comporBlocosPrompt(
  blocos: ReadonlyArray<string | null | undefined>,
  opcoes: OpcoesComposicaoPrompt = {}
): ResultadoComposicaoPrompt {
  const uteis = blocos.filter(
    (bloco): bloco is string => typeof bloco === "string" && bloco.trim() !== ""
  );
  if (uteis.length === 0) return { prompt: "", linhasDuplicadas: 0, cortado: false };

  const vistas = new Set<string>();
  const linhas: string[] = [];
  let linhasDuplicadas = 0;
  for (const bloco of uteis) {
    if (linhas.length > 0) linhas.push("");
    for (const linha of bloco.split("\n")) {
      if (vistas.has(linha)) {
        linhasDuplicadas += 1;
        continue;
      }
      vistas.add(linha);
      linhas.push(linha);
    }
  }

  let prompt = linhas.join("\n");
  const limite = opcoes.maxCaracteres;
  const cortado = typeof limite === "number" && Number.isFinite(limite) && limite > 0 && prompt.length > limite;
  if (cortado && limite !== undefined) prompt = prompt.slice(0, Math.floor(limite));
  return { prompt, linhasDuplicadas, cortado };
}
