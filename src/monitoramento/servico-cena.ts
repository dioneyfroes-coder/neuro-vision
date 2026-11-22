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
  revisarMudanca,
  registrarConfirmacaoMudanca,
  type ConsolidacaoReferenciaCena,
  type DecisaoRevisaoMudanca,
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

/** Mudança informada não existe (revisão apontou para id desconhecido). */
export class SemMudancaCenaError extends Error {
  constructor(mudancaId: string) {
    super(`Mudanca de cena desconhecida: ${mudancaId}`);
    this.name = "SemMudancaCenaError";
  }
}

export interface ResultadoComparacaoCena {
  /** Todas as mudanças resultantes da comparação, na versão persistida mais recente. */
  mudancas: MudancaCena[];
  /** Apenas as que ainda não estavam persistidas. */
  novas: MudancaCena[];
  /** Mudanças conhecidas que receberam uma nova confirmação nesta comparação. */
  confirmadas: MudancaCena[];
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
    consolidacao?: ConsolidacaoReferenciaCena;
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
    /** Acumula evidência quando uma mudança conhecida reaparece (padrão: desligado). */
    confirmarRepeticao?: boolean;
    minimoConfirmacoes?: number;
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
      const porId = new Map(
        (await this.listarMudancas(opcoes.sessaoId)).map((mudanca) => [mudanca.mudancaId, mudanca])
      );
      const novas: MudancaCena[] = [];
      const confirmadas: MudancaCena[] = [];
      const versaoAtual: MudancaCena[] = [];
      for (const mudanca of mudancas) {
        const anterior = porId.get(mudanca.mudancaId);
        if (!anterior) {
          // A primeira detecção já conta como uma observação independente:
          // `minimoConfirmacoes` é o total de observações, não de repetições.
          const registrada: MudancaCena = { ...mudanca, confirmacoes: mudanca.confirmacoes ?? 1 };
          await gravarMudancaCena(registrada, this.opcoes.mudancasFile, this.opcoes.maxBytes);
          porId.set(mudanca.mudancaId, registrada);
          novas.push(registrada);
          versaoAtual.push(registrada);
          continue;
        }
        if (opcoes.confirmarRepeticao && anterior.revisao !== "rejeitada") {
          const confirmada = registrarConfirmacaoMudanca(
            anterior,
            opcoes.detectadoEmMs,
            opcoes.minimoConfirmacoes
          );
          if (confirmada !== anterior) {
            await gravarMudancaCena(confirmada, this.opcoes.mudancasFile, this.opcoes.maxBytes);
            porId.set(mudanca.mudancaId, confirmada);
            confirmadas.push(confirmada);
            versaoAtual.push(confirmada);
            continue;
          }
        }
        versaoAtual.push(anterior);
      }
      return { mudancas: versaoAtual, novas, confirmadas };
    });
  }

  /** Aprova ou rejeita uma mudança; a decisão sobrevive a novas comparações. */
  revisar(opcoes: {
    sessaoId: string;
    mudancaId: string;
    decisao: DecisaoRevisaoMudanca;
    agoraMs: number;
  }): Promise<MudancaCena> {
    return this.enfileirar(async () => {
      const atual = (await this.listarMudancas(opcoes.sessaoId)).find(
        (mudanca) => mudanca.mudancaId === opcoes.mudancaId
      );
      if (!atual) throw new SemMudancaCenaError(opcoes.mudancaId);
      const revisada = revisarMudanca(atual, opcoes.decisao, opcoes.agoraMs);
      await gravarMudancaCena(revisada, this.opcoes.mudancasFile, this.opcoes.maxBytes);
      return revisada;
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
