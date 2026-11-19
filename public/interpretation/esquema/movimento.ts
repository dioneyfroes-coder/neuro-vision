import {
  estaIndisponivel,
  type ObservacaoFrame,
  type PontoCorporal,
} from "../../../src/domain";
import { MovimentoObservado } from "./tipos";
import { arredondar } from "./serializacao";

/** Resultado parcial do calculo de movimento para uma observacao. */
export interface ResultadoMovimento {
  movimentos: MovimentoObservado[];
  /**
   * Posicoes normalizadas no fim do frame, por `tipo:trackId`, usadas como base
   * do frame seguinte. Persistido entre frames pelo montador do contexto.
   */
  posicoes: Map<string, { x: number; y: number; tMs: number }>;
}

/**
 * Calcula o movimento das entidades entre o frame atual e as posicoes
 * observadas no frame anterior (`posicoesAnteriores`), com deslocamento e
 * direcao. Entidades sem posicao anterior nao geram movimento.
 */
export function calcularMovimento(
  observacao: ObservacaoFrame,
  posicoesAnteriores: Map<string, { x: number; y: number; tMs: number }>,
  decimais: number
): ResultadoMovimento {
  const movimentos: MovimentoObservado[] = [];
  const posicoes = new Map<string, { x: number; y: number; tMs: number }>();

  const registrar = (
    tipo: MovimentoObservado["tipo"],
    trackId: string,
    centro: { x: number; y: number } | null
  ): void => {
    if (!centro || !Number.isFinite(observacao.capturadoEmMs)) return;
    const chave = `${tipo}:${trackId}`;
    posicoes.set(chave, { x: centro.x, y: centro.y, tMs: observacao.capturadoEmMs });
    const anterior = posicoesAnteriores.get(chave);
    if (!anterior) return;
    const dx = centro.x - anterior.x;
    const dy = centro.y - anterior.y;
    const intervaloMs = Math.round(observacao.capturadoEmMs - anterior.tMs);
    if (intervaloMs <= 0) return;
    movimentos.push({
      trackId,
      tipo,
      deslocamento: arredondar(Math.hypot(dx, dy), decimais),
      direcaoGraus: Math.round(direcaoGraus(dx, dy)),
      intervaloMs,
    });
  };

  if (!estaIndisponivel(observacao.deteccoes)) {
    const dimensoes = observacao.deteccoes.dimensoes;
    if (dimensoes && dimensoes.largura > 0 && dimensoes.altura > 0) {
      for (const deteccao of observacao.deteccoes.deteccoes) {
        if (!deteccao.entidadeId) continue;
        registrar("objeto", deteccao.entidadeId, {
          x: ((deteccao.caixa.xmin + deteccao.caixa.xmax) / 2) / dimensoes.largura,
          y: ((deteccao.caixa.ymin + deteccao.caixa.ymax) / 2) / dimensoes.altura,
        });
      }
    }
  }

  if (!estaIndisponivel(observacao.pose)) {
    for (const pessoa of observacao.pose.pessoas) {
      const trackId = pessoa.entidadeId;
      if (!trackId) continue;
      registrar("pessoa", trackId, centroide(pessoa.pontos));
    }
  }
  if (!estaIndisponivel(observacao.maos)) {
    for (const mao of observacao.maos.maos) {
      const trackId = mao.entidadeId;
      if (!trackId) continue;
      registrar("mao", trackId, centroide(mao.landmarks as PontoCorporal[]));
    }
  }

  return { movimentos, posicoes };
}

/** Centroide dos pontos validos (ou de todos, se nenhum informa confianca). */
export function centroide(pontos: PontoCorporal[]): { x: number; y: number } | null {
  if (!pontos || pontos.length === 0) return null;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const p of pontos) {
    if (!p || typeof p.x !== "number" || typeof p.y !== "number") continue;
    if (p.confianca !== undefined && p.confianca < 0.05) continue;
    sx += p.x;
    sy += p.y;
    n += 1;
  }
  if (n === 0) return null;
  return { x: sx / n, y: sy / n };
}

/**
 * Direcao do deslocamento em graus [0, 360), topo = 0, sentido horario. Sem
 * deslocamento, retorna 0 (direcao indeterminada, nao fabricada).
 */
function direcaoGraus(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return 0;
  const angulo = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return (angulo + 360) % 360;
}