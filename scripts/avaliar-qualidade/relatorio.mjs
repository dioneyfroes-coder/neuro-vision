import { arredondar } from "./constantes.mjs";

function pct(n) {
  return Number.isFinite(n) ? `${(n * 100).toFixed(0)}%` : "N/A";
}

/** Numero para exibicao; `null`/NaN viram N/A (nunca 0 silencioso). */
function valorOuNa(n, casas = 2) {
  return Number.isFinite(n) ? String(arredondar(n, casas)) : "N/A";
}

/** Relatorio legivel (modo padrao, sem `--json`). */
export function formatarRelatorio(rel, { clip = "", toleranciaMs = 0 } = {}) {
  const linhas = [
    `Clipe: ${clip || "(sem nome)"} | tolerancia: ${toleranciaMs} ms | duracao: ${arredondar(rel.duracaoMs / 60_000, 2)} min`,
    `Esperados: ${rel.esperados} | detectados: ${rel.detectados}`,
    `Verdadeiros positivos: ${rel.verdadeirosPositivos} | perdidos: ${rel.perdidos} | falsos positivos: ${rel.falsosPositivos}`,
    `Precisao: ${pct(rel.precisao)} | recall: ${pct(rel.recall)} | falsos positivos/min: ${valorOuNa(rel.falsosPositivosPorMinuto, 2)}`,
  ];
  if (rel.foraEscopo > 0) linhas.push(`Fora do escopo avaliado: ${rel.foraEscopo}`);
  if (rel.semClassificacaoEscopo > 0) {
    linhas.push(`Movimentos sem classificação de escopo: ${rel.semClassificacaoEscopo}`);
  }
  if (rel.movimentosPessoaExcluidos > 0) {
    linhas.push(`Movimentos de pessoa excluídos: ${rel.movimentosPessoaExcluidos}`);
  }
  if (rel.perdidosDetalhe.length) {
    linhas.push("Perdidas:");
    for (const p of rel.perdidosDetalhe) {
      linhas.push(`  - ${p.tipo} @ ${p.em} ms${p.descricao ? ` (${p.descricao})` : ""}`);
    }
    if (rel.indeterminados) {
      linhas.push(`Excluidos por indeterminacao: ${rel.indeterminados}`);
    }
  }
  if (rel.falsosPositivosDetalhe.length) {
    linhas.push("Falsos positivos:");
    for (const f of rel.falsosPositivosDetalhe) {
      linhas.push(`  - ${f.tipo} @ ${Math.round(f.em)} ms${f.descricao ? ` (${f.descricao})` : ""}`);
    }
  }
  return linhas.join("\n");
}
