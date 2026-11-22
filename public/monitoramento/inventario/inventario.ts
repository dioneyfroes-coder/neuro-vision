/**
 * Pipeline do inventário automático (Fase 2).
 *
 * Este módulo não conhece câmera, DOM nem `fetch`: câmera, detector e API são
 * injetados pela interface. Assim a coleta de quadros e a comparação podem ser
 * testadas com relógio e detecções determinísticos.
 */
import {
  itensCenaDeDeteccoes,
  LIMITE_CONFIANCA_INVENTARIO_PADRAO,
  type ConsolidacaoReferenciaCena,
  type ItemCena,
  type MudancaCena,
  type OpcoesComparacaoCena,
  type ReferenciaCena,
} from "../../../src/domain/cena";
import type {
  ResultadoDeteccaoLocal,
  ResultadoIndisponivel,
} from "../../../src/domain/perception";
import type { Dimensoes } from "../../perception/contracts";

/** Evidência mínima de um quadro usado no inventário. */
export interface QuadroInventario {
  frameId: string;
  imagem: string;
  /** Instante epoch-ms da captura, lido antes da inferência. */
  capturadoEmMs: number;
  dimensoes?: Dimensoes;
}

export type DeteccoesInventario = ResultadoDeteccaoLocal | ResultadoIndisponivel;

export interface ResultadoComparacaoInventario {
  mudancas: MudancaCena[];
  novas: MudancaCena[];
  confirmadas: MudancaCena[];
}

export interface OpcoesColetarReferenciaInventario {
  sessaoId: string;
  quadros: number;
  capturar: () => Promise<QuadroInventario | null>;
  detectar: (quadro: QuadroInventario) => Promise<DeteccoesInventario>;
  definirReferencia: (opcoes: {
    sessaoId: string;
    itens: ItemCena[];
    criadaEmMs: number;
    quadros: number;
    consolidacao?: ConsolidacaoReferenciaCena;
  }) => Promise<ReferenciaCena>;
  agoraMs?: () => number;
  esperar?: (ms: number) => Promise<void>;
  intervaloMs?: number;
  limiteConfianca?: number;
  consolidacao?: ConsolidacaoReferenciaCena;
  /** Falha de um quadro é registrada sem fabricar ausência. */
  aoErro?: (erro: Error) => void;
}

/**
 * Coleta N quadros, converte as detecções e consolida o inventário inicial.
 *
 * Quadros sem câmera, com detector indisponível ou sem dimensões são
 * **ignorados** e informados por `aoErro`: o inventário resultante é parcial,
 * mas `quadros` reflete somente a evidência que realmente entrou nele.
 */
export async function coletarReferenciaInventario(
  opcoes: OpcoesColetarReferenciaInventario
): Promise<ReferenciaCena> {
  if (!Number.isInteger(opcoes.quadros) || opcoes.quadros < 1) {
    throw new Error("quadros deve ser inteiro maior ou igual a 1");
  }
  const agoraMs = opcoes.agoraMs ?? Date.now;
  const esperar = opcoes.esperar ?? (() => Promise.resolve());
  const criadaEmMs = agoraMs();
  const itens: ItemCena[] = [];
  let quadrosValidos = 0;
  const notar = (erro: unknown) =>
    opcoes.aoErro?.(erro instanceof Error ? erro : new Error(String(erro)));

  for (let indice = 0; indice < opcoes.quadros; indice += 1) {
    if (indice > 0 && (opcoes.intervaloMs ?? 0) > 0) await esperar(opcoes.intervaloMs ?? 0);
    try {
      const quadro = await opcoes.capturar();
      if (!quadro) {
        notar(new Error(`Quadro ${indice + 1} indisponível`));
        continue;
      }
      const deteccoes = await opcoes.detectar(quadro);
      const convertidos = itensCenaDeDeteccoes({
        deteccoes,
        dimensoes: quadro.dimensoes,
        frameId: quadro.frameId,
        capturadoEmMs: quadro.capturadoEmMs,
        ...(opcoes.limiteConfianca !== undefined
          ? { limiteConfianca: opcoes.limiteConfianca }
          : {}),
      });
      itens.push(...convertidos);
      quadrosValidos += 1;
    } catch (err) {
      notar(err);
    }
  }

  if (quadrosValidos === 0) {
    throw new Error("Nenhum quadro válido para construir o inventário");
  }
  return opcoes.definirReferencia({
    sessaoId: opcoes.sessaoId,
    itens,
    criadaEmMs,
    quadros: quadrosValidos,
    ...(opcoes.consolidacao ? { consolidacao: opcoes.consolidacao } : {}),
  });
}

export interface OpcoesCompararObservacaoInventario {
  sessaoId: string;
  quadro: QuadroInventario;
  deteccoes: DeteccoesInventario;
  comparar: (opcoes: {
    sessaoId: string;
    itens: ItemCena[];
    agoraMs: number;
    comparacao: OpcoesComparacaoCena;
    confirmarRepeticao: boolean;
  }) => Promise<ResultadoComparacaoInventario>;
  limiteConfianca?: number;
}

/**
 * Compara uma observação já detectada com a referência da sessão.
 *
 * Reaproveita o quadro e a inferência que a análise de segurança já fez — não
 * há segunda captura nem segundo detector — e pede ao servidor que acumule
 * confirmações das mudanças repetidas.
 */
export async function compararObservacaoInventario(
  opcoes: OpcoesCompararObservacaoInventario
): Promise<ResultadoComparacaoInventario> {
  const itens = itensCenaDeDeteccoes({
    deteccoes: opcoes.deteccoes,
    dimensoes: opcoes.quadro.dimensoes,
    frameId: opcoes.quadro.frameId,
    capturadoEmMs: opcoes.quadro.capturadoEmMs,
    limiteConfianca: opcoes.limiteConfianca ?? LIMITE_CONFIANCA_INVENTARIO_PADRAO,
  });
  return opcoes.comparar({
    sessaoId: opcoes.sessaoId,
    itens,
    agoraMs: opcoes.quadro.capturadoEmMs,
    comparacao: { associacaoPorInstancia: true },
    confirmarRepeticao: true,
  });
}
