/**
 * Revisão local NSFW (Fase 5, plano §14).
 *
 * Liga a comparação determinística de descrições e o repositório de feedback
 * aos controles da interface. A comparação é lexical e o feedback guarda só
 * metadados/texto; o único pedido de rede é o warm-up explícito do Gemma.
 */

import { compararDescricoes } from "../../src/domain/comparacao-descricoes";
import {
  formatarComparacao,
  formatarItemFeedback,
  formatarResumoFeedback,
} from "../../src/domain/formatacao-revisao";
import { prepararVisao } from "../api/visao";
import type { RegistroFeedbackNsfw, ResumoFeedbackNsfw } from "../../src/domain/feedback-local";
import {
  armazenamentoLocalStorage,
  criarRepositorioFeedbackLocal,
  type ArmazenamentoFeedback,
} from "./feedback-local";
import {
  comparacaoEspecializadaInput,
  comparacaoResultadoEl,
  compararDescricoesBtn,
  feedbackCicloIdInput,
  feedbackDescricaoInput,
  feedbackExportarBtn,
  feedbackFrameIdInput,
  feedbackLimparBtn,
  feedbackListaEl,
  feedbackRotuloInput,
  feedbackSalvarBtn,
  feedbackTipoSelect,
  revisaoResumoEl,
  comparacaoSfwInput,
  warmupGemmaBtn,
  warmupGemmaResultadoEl,
} from "./elementos";

export interface RelogioRevisao {
  agora(): string;
  id(): string;
}

const relogioPadrao: RelogioRevisao = {
  agora: () => new Date().toISOString(),
  id: () => `fb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
};

export interface RevisaoLocal {
  comparar(): string;
  listar(): RegistroFeedbackNsfw[];
  resumo(): ResumoFeedbackNsfw;
  salvar(): RegistroFeedbackNsfw[];
  remover(id: string): RegistroFeedbackNsfw[];
  marcarRevisado(id: string): RegistroFeedbackNsfw[];
  limpar(): void;
  exportar(): string;
}

/** Fachada ligada aos controles; `armazenamento` pode ser injetado em testes de UI. */
export function criarRevisaoLocal(
  armazenamento: ArmazenamentoFeedback = armazenamentoLocalStorage(),
  relogio: RelogioRevisao = relogioPadrao
): RevisaoLocal {
  const repositorio = criarRepositorioFeedbackLocal(armazenamento);
  return {
    comparar() {
      return formatarComparacao(
        compararDescricoes(comparacaoSfwInput.value, comparacaoEspecializadaInput.value)
      );
    },
    listar: () => repositorio.listar(),
    resumo: () => repositorio.resumo(),
    salvar() {
      return repositorio.adicionar({
        id: relogio.id(),
        tipo: feedbackTipoSelect.value,
        criadoEm: relogio.agora(),
        ...(feedbackFrameIdInput.value.trim()
          ? { frameId: feedbackFrameIdInput.value.trim() }
          : {}),
        ...(feedbackCicloIdInput.value.trim()
          ? { cicloId: feedbackCicloIdInput.value.trim() }
          : {}),
        ...(feedbackRotuloInput.value.trim() ? { rotulo: feedbackRotuloInput.value.trim() } : {}),
        ...(feedbackDescricaoInput.value.trim()
          ? { descricao: feedbackDescricaoInput.value.trim() }
          : {}),
      });
    },
    remover: (id) => repositorio.remover(id),
    marcarRevisado: (id) => repositorio.marcarRevisado(id),
    limpar: () => repositorio.limpar(),
    exportar: () => repositorio.exportar(),
  };
}

function renderizar(revisao: RevisaoLocal): void {
  const registros = revisao.listar();
  revisaoResumoEl.textContent = formatarResumoFeedback(revisao.resumo());
  feedbackListaEl.replaceChildren(
    ...registros.map((registro) => {
      const item = document.createElement("li");
      item.textContent = formatarItemFeedback(registro);
      const revisado = document.createElement("button");
      revisado.type = "button";
      revisado.className = "ghost";
      revisado.textContent = registro.revisado ? "já revisado" : "marcar revisado";
      revisado.disabled = registro.revisado;
      revisado.addEventListener("click", () => {
        revisao.marcarRevisado(registro.id);
        renderizar(revisao);
      });
      const excluir = document.createElement("button");
      excluir.type = "button";
      excluir.className = "ghost";
      excluir.textContent = "excluir";
      excluir.addEventListener("click", () => {
        revisao.remover(registro.id);
        renderizar(revisao);
      });
      item.append(" ", revisado, " ", excluir);
      return item;
    })
  );
  if (registros.length === 0) {
    const vazio = document.createElement("li");
    vazio.textContent = "Nenhum feedback salvo neste navegador.";
    feedbackListaEl.append(vazio);
  }
}

/** Instala os handlers uma única vez. Chamado na inicialização de `app.ts`. */
export function iniciarRevisaoLocal(): void {
  const revisao = criarRevisaoLocal();
  compararDescricoesBtn.addEventListener("click", () => {
    comparacaoResultadoEl.textContent = revisao.comparar();
  });
  warmupGemmaBtn.addEventListener("click", () => {
    warmupGemmaBtn.disabled = true;
    warmupGemmaResultadoEl.textContent = "preparando Gemma...";
    void prepararVisao(undefined, { nsfw: true })
      .then((preparacao) => {
        const efetivo = preparacao.modelo ?? "(não informado)";
        const solicitado = preparacao.solicitado ?? efetivo;
        const situacao = preparacao.gemma?.status ?? "não informado";
        warmupGemmaResultadoEl.textContent =
          `solicitado ${solicitado} -> efetivo ${efetivo}\n` +
          `gemma ${situacao}${preparacao.carregado ? " carregado" : " carga não confirmada"}\n` +
          "sem fallback para modelo SFW";
      })
      .catch((err: unknown) => {
        warmupGemmaResultadoEl.textContent =
          err instanceof Error ? err.message : "Falha ao preparar o Gemma";
      })
      .finally(() => {
        warmupGemmaBtn.disabled = false;
      });
  });
  feedbackSalvarBtn.addEventListener("click", () => {
    revisao.salvar();
    renderizar(revisao);
  });
  feedbackExportarBtn.addEventListener("click", () => {
    const dados = revisao.exportar();
    const url = URL.createObjectURL(new Blob([dados], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "feedback-nsfw-local.json";
    link.click();
    URL.revokeObjectURL(url);
  });
  feedbackLimparBtn.addEventListener("click", () => {
    revisao.limpar();
    comparacaoResultadoEl.textContent = "sem comparação";
    renderizar(revisao);
  });
  renderizar(revisao);
}
