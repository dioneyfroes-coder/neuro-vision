import { estaIndisponivel, type MaoDetectada, type ObservacaoFrame, type PessoaPose } from "../../../src/domain";
import type { AmostraInteracao } from "../interacao";
import type { AmostraPresenca } from "../presenca-pessoas";
import type { Entidade } from "../rastreador-entidades";
import { continuidadeDaEntidade } from "../motor-temporal-regras";

/**
 * Monta uma amostra por track de pose no frame. Tracks que continuam vivos
 * mas nao foram associados a nenhuma sonda entram como `observado: false`:
 * e essa distincao que permite histerese sem confundir oclusao com falha.
 */
export function montarAmostrasPresenca(
  pessoasVivas: readonly Entidade[],
  pessoas: PessoaPose[],
  sessionId: string,
  tempoMs: number,
  timestamp: string,
  frameId: string,
  cycleId: string
): AmostraPresenca[] {
  const porId = new Map<string, Entidade>();
  for (const entidade of pessoasVivas) {
    porId.set(entidade.entidadeId, entidade);
  }

  const amostras: AmostraPresenca[] = [];
  const vistos = new Set<string>();
  for (const pessoa of pessoas) {
    if (!pessoa.entidadeId) continue;
    const entidade = porId.get(pessoa.entidadeId);
    if (!entidade) continue;
    vistos.add(pessoa.entidadeId);
    const referencia = entidade.meta.referenciaPose;
    amostras.push({
      sessionId,
      entidadeId: pessoa.entidadeId,
      frameId,
      timestamp,
      tempoMs,
      cycleId,
      observado: entidade.estado === "ativa",
      continuidadeValida: continuidadeDaEntidade(entidade),
      confianca: pessoa.confianca ?? entidade.confianca,
      fonteReferencia: typeof referencia === "string" ? referencia : undefined,
    });
  }

  for (const entidade of pessoasVivas) {
    if (vistos.has(entidade.entidadeId)) continue;
    const referencia = entidade.meta.referenciaPose;
    amostras.push({
      sessionId,
      entidadeId: entidade.entidadeId,
      frameId,
      timestamp,
      tempoMs,
      cycleId,
      observado: false,
      continuidadeValida: continuidadeDaEntidade(entidade),
      confianca: entidade.confianca,
      fonteReferencia: typeof referencia === "string" ? referencia : undefined,
    });
  }

  return amostras;
}

/**
 * Monta uma amostra por par (mao, objeto) no frame. As caixas vem em pixels
 * e sao normalizadas pelas dimensoes da deteccao para compartilhar o espaco
 * dos landmarks da mao. Sem dimensoes, a comparacao nao e confiavel e o par
 * e descartado (melhor abster que afirmar proximidade em escalas distintas).
 */
export function montarAmostrasInteracao(
  maosVivas: readonly Entidade[],
  maos: MaoDetectada[],
  deteccoes: ObservacaoFrame["deteccoes"],
  dimensoes: { largura: number; altura: number } | undefined,
  sessionId: string,
  tempoMs: number,
  timestamp: string,
  frameId: string,
  cycleId: string
): AmostraInteracao[] {
  if (!dimensoes || estaIndisponivel(deteccoes)) return [];
  const { largura, altura } = dimensoes;
  if (!(largura > 0) || !(altura > 0)) return [];
  const continuidadePorMao = new Map<string, boolean>();
  for (const entidade of maosVivas) {
    continuidadePorMao.set(entidade.entidadeId, continuidadeDaEntidade(entidade));
  }
  const amostras: AmostraInteracao[] = [];
  for (const mao of maos) {
    if (!mao.entidadeId) continue;
    const punho = mao.landmarks[0];
    if (!punho || typeof punho.x !== "number" || typeof punho.y !== "number") continue;
    const confiancaMao = mao.gesto?.confianca ?? 0.8;
    for (const deteccao of deteccoes.deteccoes) {
      if (!deteccao.entidadeId) continue;
      amostras.push({
        sessionId,
        maoEntidadeId: mao.entidadeId,
        objetoEntidadeId: deteccao.entidadeId,
        rotuloObjeto: deteccao.nome || deteccao.rotulo || undefined,
        punhoMao: { x: punho.x, y: punho.y },
        caixaObjeto: {
          xmin: deteccao.caixa.xmin / largura,
          ymin: deteccao.caixa.ymin / altura,
          xmax: deteccao.caixa.xmax / largura,
          ymax: deteccao.caixa.ymax / altura,
        },
        confianca: Math.min(confiancaMao, deteccao.score),
        frameId,
        timestamp,
        tempoMs,
        cycleId,
        observado: true,
        continuidadeValida: continuidadePorMao.get(mao.entidadeId) ?? true,
      });
    }
  }
  return amostras;
}
