/**
 * Repositório local de feedback (Fase 5, plano §14).
 *
 * Usa um armazenamento injetado (localStorage no navegador, mapa em memória nos
 * testes). Não grava imagem, vídeo, log ou peso: apenas metadados e texto do
 * revisor. O chamador pode remover um registro ou limpar todos — a exclusão da
 * mídia continua sendo feita pelo fluxo de snapshots existente.
 */

import {
  exportarFeedbackNsfw,
  marcarFeedbackRevisado,
  mesclarFeedbackNsfw,
  normalizarFeedbackNsfw,
  removerFeedbackNsfw,
  resumoFeedbackNsfw,
  type RegistroFeedbackNsfw,
  type ResumoFeedbackNsfw,
} from "../../src/domain/feedback-local";

export interface ArmazenamentoFeedback {
  ler(): string | null;
  gravar(valor: string): void;
  remover(): void;
}

export const CHAVE_FEEDBACK_NSFW = "neuro.feedback.nsfw.v1";

function interpretar(conteudo: string | null): RegistroFeedbackNsfw[] {
  if (!conteudo) return [];
  try {
    const dados = JSON.parse(conteudo) as { registros?: unknown };
    if (!Array.isArray(dados.registros)) return [];
    return dados.registros
      .map(normalizarFeedbackNsfw)
      .filter((registro): registro is RegistroFeedbackNsfw => registro !== null);
  } catch {
    return [];
  }
}

export function criarRepositorioFeedbackLocal(armazenamento: ArmazenamentoFeedback) {
  const ler = (): RegistroFeedbackNsfw[] => {
    try {
      return interpretar(armazenamento.ler());
    } catch {
      return [];
    }
  };
  const gravar = (registros: ReadonlyArray<RegistroFeedbackNsfw>): void => {
    armazenamento.gravar(exportarFeedbackNsfw(registros));
  };
  return {
    listar: ler,
    adicionar(valor: unknown): RegistroFeedbackNsfw[] {
      const registro = normalizarFeedbackNsfw(valor);
      if (!registro) return ler();
      const registros = mesclarFeedbackNsfw(ler(), [registro]);
      gravar(registros);
      return registros;
    },
    remover(id: string): RegistroFeedbackNsfw[] {
      const registros = removerFeedbackNsfw(ler(), id);
      gravar(registros);
      return registros;
    },
    marcarRevisado(id: string): RegistroFeedbackNsfw[] {
      const registros = marcarFeedbackRevisado(ler(), id);
      gravar(registros);
      return registros;
    },
    limpar(): void {
      armazenamento.remover();
    },
    resumo(): ResumoFeedbackNsfw {
      return resumoFeedbackNsfw(ler());
    },
    exportar(): string {
      return exportarFeedbackNsfw(ler());
    },
  };
}

/** Adapter para `localStorage`, sem Accesso a ele durante imports de teste. */
export function armazenamentoLocalStorage(): ArmazenamentoFeedback {
  return {
    ler: () => localStorage.getItem(CHAVE_FEEDBACK_NSFW),
    gravar: (valor) => localStorage.setItem(CHAVE_FEEDBACK_NSFW, valor),
    remover: () => localStorage.removeItem(CHAVE_FEEDBACK_NSFW),
  };
}
