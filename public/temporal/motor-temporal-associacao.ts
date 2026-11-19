import type { MaoDetectada, PessoaPose, PontoCorporal } from "../../src/domain";
import { distanciaPontos } from "./suavizador";
import { CONFIANCA_MINIMA_PUNHO_MAO_PESSOA, pontoConfiavel } from "./motor-temporal-regras";

/**
 * Associa cada mao a uma pessoa rastreada pelo punho.
 *
 * A mao usa o landmark 0 (punho); a pose usa os punhos COCO 9 (esquerdo) e 10
 * (direito). Com lateralidade conhecida, a distancia e medida primeiro no
 * punho do mesmo lado — evita atribuir a mao esquerda a uma pessoa cujo punho
 * direito passou perto. O outro punho so entra quando o correspondente nao e
 * confiavel. Se houver apenas uma pessoa ativa, ela e o fallback mesmo fora do
 * raio: numa cena de uma pessoa so, deixar a mao sem dono nao agrega nada.
 *
 * A associacao e uma **heuristica de proximidade**, nao identidade fisica;
 * quando ambigua, a mao fica sem `pessoaEntidadeId` (abstencao explicita).
 */
export function associarMaosAPessoas(
  poses: PessoaPose[],
  maos: MaoDetectada[],
  raio: number
): void {
  const pessoas = poses.filter(
    (pose): pose is PessoaPose & { entidadeId: string } => typeof pose.entidadeId === "string"
  );
  if (pessoas.length === 0) return;

  for (const mao of maos) {
    const punho = mao.landmarks[0];
    const pontoMao =
      punho && typeof punho.x === "number" && typeof punho.y === "number"
        ? { x: punho.x, y: punho.y }
        : null;

    let melhor: { entidadeId: string; distancia: number } | null = null;
    if (pontoMao) {
      for (const pessoa of pessoas) {
        for (const ponto of punhosDaPessoa(pessoa, mao.lateralidade)) {
          const distancia = distanciaPontos(pontoMao, ponto);
          if (!melhor || distancia < melhor.distancia) {
            melhor = { entidadeId: pessoa.entidadeId, distancia };
          }
        }
      }
    }

    if (melhor && melhor.distancia <= raio) {
      mao.pessoaEntidadeId = melhor.entidadeId;
    } else if (pessoas.length === 1) {
      mao.pessoaEntidadeId = pessoas[0].entidadeId;
    }
  }
}

/**
 * Punhos da pose candidatos para uma mao.
 *
 * Lateralidade conhecida prioriza o punho do mesmo lado; se ele nao for
 * confiavel, o outro e usado. Desconhecida considera os dois.
 */
export function punhosDaPessoa(
  pessoa: PessoaPose,
  lateralidade: MaoDetectada["lateralidade"]
): PontoCorporal[] {
  const esquerdo = pontoConfiavel(
    pessoa.pontos[9],
    CONFIANCA_MINIMA_PUNHO_MAO_PESSOA
  );
  const direito = pontoConfiavel(
    pessoa.pontos[10],
    CONFIANCA_MINIMA_PUNHO_MAO_PESSOA
  );
  if (lateralidade === "esquerda") {
    const ponto = esquerdo ?? direito;
    return ponto ? [ponto] : [];
  }
  if (lateralidade === "direita") {
    const ponto = direito ?? esquerdo;
    return ponto ? [ponto] : [];
  }
  return [esquerdo, direito].filter((ponto): ponto is PontoCorporal => ponto !== null);
}
