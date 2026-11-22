/**
 * Ponte entre detecções locais (YOLO) e o inventário de cena.
 *
 * O detector entrega caixas em **pixels** e um resultado que pode ser
 * `indisponivel`/`naoAmostrado`. Aqui esses sinais viram `ItemCena` com caixa
 * normalizada, identidade de instância e evidência temporal. Falha ou frame
 * pulado nunca vira `nao_observado`: ausência é uma afirmação, não um efeito
 * colateral de conversão.
 */
import { statusEvidenciaCena } from "../evidencia";
import {
  estaIndisponivel,
  type Deteccao,
  type ResultadoDeteccaoLocal,
  type ResultadoIndisponivel,
} from "../perception";
import type { ItemCena } from "./tipos";
import { finito, normalizarCaixaCena } from "./validacao";

/** Limiar padrão para tratar uma detecção como observação direta. */
export const LIMITE_CONFIANCA_INVENTARIO_PADRAO = 0.45;

/** Granularidade da chave espacial usada quando o rastreador não deu um ID. */
const GRADE_INSTANCIA = 10;

export interface OpcoesItensCenaDeDeteccoes {
  /** Resultado bruto do adaptador de objetos (já normalizado pelo domínio). */
  deteccoes: ResultadoDeteccaoLocal | ResultadoIndisponivel | null | undefined;
  /** Dimensões da imagem analisada, quando o resultado não as carrega. */
  dimensoes?: { largura: number; altura: number };
  /** Id do frame de origem, propagado como evidência. */
  frameId: string;
  /** Instante epoch-ms da captura — não o fim da inferência. */
  capturadoEmMs: number;
  /** Acima deste valor a detecção é `confirmado`; abaixo, `possivel`. */
  limiteConfianca?: number;
}

function chaveInstancia(
  deteccao: Deteccao,
  caixaNormalizada: { xmin: number; ymin: number; xmax: number; ymax: number },
  indice = -1
): string {
  if (deteccao.entidadeId?.trim()) return deteccao.entidadeId.trim();
  const rotulo = deteccao.rotulo.trim() || deteccao.nome.trim();
  const centroX = Math.round(
    ((caixaNormalizada.xmin + caixaNormalizada.xmax) / 2) * GRADE_INSTANCIA
  );
  const centroY = Math.round(
    ((caixaNormalizada.ymin + caixaNormalizada.ymax) / 2) * GRADE_INSTANCIA
  );
  // Sem ID do rastreador, a posição aproximada identifica a instância dentro
  // do lote. O sufixo só aparece se duas caixas caírem na mesma célula.
  return `${rotulo}@${centroX}:${centroY}${indice >= 0 ? `:${indice}` : ""}`;
}

/**
 * Converte detecções em itens de cena prontos para consolidação.
 *
 * - `indisponivel`/`naoAmostrado`/resultado ausente produzem lista vazia;
 * - detecções sem dimensões da imagem não podem ser normalizadas e geram erro
 *   explícito — silentamente descartá-las falsificaria uma ausência;
 * - `objetoId` deriva da instância (ID do rastreador ou chave espacial estável)
 *   para que `mudancaId` sobreviva a comparações em quadros posteriores.
 */
export function itensCenaDeDeteccoes(opcoes: OpcoesItensCenaDeDeteccoes): ItemCena[] {
  if (!finito(opcoes.capturadoEmMs)) throw new Error("capturadoEmMs deve ser finito");
  if (estaIndisponivel(opcoes.deteccoes) || !opcoes.deteccoes) return [];

  const dimensoes = opcoes.deteccoes.dimensoes ?? opcoes.dimensoes;
  const limite = opcoes.limiteConfianca ?? LIMITE_CONFIANCA_INVENTARIO_PADRAO;
  if (!finito(limite) || limite < 0 || limite > 1) {
    throw new Error("limiteConfianca deve estar em [0, 1]");
  }

  const deteccoes = opcoes.deteccoes.deteccoes.filter(
    (deteccao) => deteccao.nome.trim().length > 0 || deteccao.rotulo.trim().length > 0
  );
  if (deteccoes.length === 0) return [];
  if (
    !dimensoes ||
    !finito(dimensoes.largura) ||
    dimensoes.largura <= 0 ||
    !finito(dimensoes.altura) ||
    dimensoes.altura <= 0
  ) {
    throw new Error("dimensoes da imagem são obrigatórias para normalizar detecções");
  }

  const vistos = new Set<string>();
  return deteccoes.map((deteccao) => {
    const caixa = normalizarCaixaCena(deteccao.caixa, dimensoes.largura, dimensoes.altura);
    const confianca = Math.max(0, Math.min(1, deteccao.score));
    const rotulo = deteccao.nome.trim() || deteccao.rotulo.trim();
    let instanciaId = chaveInstancia(deteccao, caixa);
    if (vistos.has(instanciaId)) {
      let indice = 0;
      while (vistos.has(chaveInstancia(deteccao, caixa, indice))) indice += 1;
      instanciaId = chaveInstancia(deteccao, caixa, indice);
    }
    vistos.add(instanciaId);

    const confirmacao = confianca >= limite ? "confirmado" : "possivel";
    return {
      objetoId: instanciaId,
      rotulo,
      classe: deteccao.rotulo.trim() || rotulo,
      caixa,
      confirmacao,
      confianca,
      frameId: opcoes.frameId,
      frameIds: [opcoes.frameId],
      observadoEmMs: opcoes.capturadoEmMs,
      primeiraObservacaoEmMs: opcoes.capturadoEmMs,
      ultimaObservacaoEmMs: opcoes.capturadoEmMs,
      instanciaId,
      statusEvidencia: statusEvidenciaCena(confirmacao),
    } satisfies ItemCena;
  });
}
