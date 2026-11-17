/**
 * Serviço da referência do ambiente e da comparação de cenas (Fase 3).
 *
 * Compoe as regras puras de `src/domain/cena.ts` com o índice JSONL. Como o
 * gerenciador de gravação, não lê relógio: `criadaEmMs`/`detectadoEmMs` vêm de
 * quem chama. As mutações são serializadas para que duas comparações
 * concorrentes não persistam a mesma mudança duas vezes.
 */
import {
  compararCena,
  construirReferencia,
  type ItemCena,
  type MudancaCena,
  type OpcoesComparacaoCena,
  type ReferenciaCena,
} from "../domain";
import {
  gravarMudancaCena,
  gravarReferenciaCena,
  lerMudancasCena,
  lerReferenciaCena,
} from "../persistence/repositorio-cena";

export const LIMITE_INDICE_CENA_PADRAO = 2_000;

export interface OpcoesServicoCena {
  referenciasFile: string;
  mudancasFile: string;
  maxBytes: number;
}

/** Não há referência para comparar: conflito de estado, não payload inválido. */
export class SemReferenciaCenaError extends Error {
  constructor(sessaoId: string) {
    super(`Sessao ${sessaoId} nao possui referencia de ambiente`);
    this.name = "SemReferenciaCenaError";
  }
}

export interface ResultadoComparacaoCena {
  /** Todas as mudanças resultantes da comparação (inclusive as já conhecidas). */
  mudancas: MudancaCena[];
  /** Apenas as que ainda não estavam persistidas. */
  novas: MudancaCena[];
}

export class ServicoCena {
  private fila: Promise<unknown> = Promise.resolve();

  constructor(private readonly opcoes: OpcoesServicoCena) {}

  /** Consolida e persiste o inventário inicial da sessão. */
  definirReferencia(opcoes: {
    sessaoId: string;
    itens: ItemCena[];
    criadaEmMs: number;
    quadros?: number;
  }): Promise<ReferenciaCena> {
    return this.enfileirar(async () => {
      const referencia = construirReferencia(opcoes);
      await gravarReferenciaCena(
        referencia,
        this.opcoes.referenciasFile,
        this.opcoes.maxBytes
      );
      return referencia;
    });
  }

  /** Referência mais recente da sessão, ou `null`. */
  obterReferencia(sessaoId: string): Promise<ReferenciaCena | null> {
    return lerReferenciaCena(
      sessaoId,
      this.opcoes.referenciasFile,
      LIMITE_INDICE_CENA_PADRAO
    );
  }

  /** Compara com a referência e persiste apenas mudanças ainda desconhecidas. */
  comparar(opcoes: {
    sessaoId: string;
    itens: ItemCena[];
    detectadoEmMs: number;
    comparacao?: OpcoesComparacaoCena;
  }): Promise<ResultadoComparacaoCena> {
    return this.enfileirar(async () => {
      const referencia = await this.obterReferencia(opcoes.sessaoId);
      if (!referencia) throw new SemReferenciaCenaError(opcoes.sessaoId);
      const mudancas = compararCena(
        referencia,
        opcoes.itens,
        opcoes.detectadoEmMs,
        opcoes.comparacao
      );
      const conhecidas = new Set(
        (await this.listarMudancas(opcoes.sessaoId)).map((mudanca) => mudanca.mudancaId)
      );
      const novas: MudancaCena[] = [];
      for (const mudanca of mudancas) {
        if (conhecidas.has(mudanca.mudancaId)) continue;
        await gravarMudancaCena(mudanca, this.opcoes.mudancasFile, this.opcoes.maxBytes);
        conhecidas.add(mudanca.mudancaId);
        novas.push(mudanca);
      }
      return { mudancas, novas };
    });
  }

  /** Linha do tempo de mudanças da sessão, sem duplicatas. */
  listarMudancas(
    sessaoId: string,
    limit = LIMITE_INDICE_CENA_PADRAO
  ): Promise<MudancaCena[]> {
    return lerMudancasCena(sessaoId, this.opcoes.mudancasFile, limit);
  }

  private enfileirar<T>(acao: () => Promise<T>): Promise<T> {
    const execucao = this.fila.then(acao, acao);
    this.fila = execucao.then(
      () => undefined,
      () => undefined
    );
    return execucao;
  }
}
