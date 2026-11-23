/** Formatação textual pura da revisão local (Fase 5). Sem DOM e sem IO. */

import type { ComparacaoDescricoes } from "./comparacao-descricoes";
import type { RegistroFeedbackNsfw, ResumoFeedbackNsfw } from "./feedback-local";

/** `sem_dados` nunca é exibido como "0%" — ausência de dado não é medição. */
export function formatarComparacao(comparacao: ComparacaoDescricoes): string {
  if (comparacao.status === "sem_dados") {
    return `sem dados: ${comparacao.motivo ?? "descrições ausentes"} (N/A)`;
  }
  const semelhanca =
    comparacao.semelhancaLexica === null
      ? "N/A"
      : `${Math.round(comparacao.semelhancaLexica * 100)}% lexical`;
  return [
    `semelhança lexical: ${semelhanca} (inspeção; não é precisão)`,
    `comuns: ${comparacao.comuns.join(", ") || "—"}`,
    `somente SFW: ${comparacao.somenteSfw.join(", ") || "—"}`,
    `somente especializada: ${comparacao.somenteEspecializada.join(", ") || "—"}`,
  ].join("\n");
}

export function formatarResumoFeedback(resumo: ResumoFeedbackNsfw): string {
  if (resumo.total === 0) return "sem feedback";
  return `${resumo.total} registro(s), ${resumo.pendentes} pendente(s), ${resumo.revisados} revisado(s)`;
}

export function formatarItemFeedback(registro: RegistroFeedbackNsfw): string {
  const alvo = [
    registro.frameId ? `frame ${registro.frameId}` : "",
    registro.cicloId ? `ciclo ${registro.cicloId}` : "",
    registro.rotulo ? `rótulo ${registro.rotulo}` : "",
  ]
    .filter((parte) => parte !== "")
    .join(" · ");
  const descricao = registro.descricao ? ` — ${registro.descricao}` : "";
  return `${registro.tipo} · ${registro.criadoEm}${registro.revisado ? " · revisado" : ""}${alvo ? ` · ${alvo}` : ""}${descricao}`;
}
