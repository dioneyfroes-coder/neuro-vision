import path from "node:path";
import { ROOT } from "../constantes.mjs";
import { identificarVarianteDoRegistro } from "../artefatos.mjs";
import { verificarMesmoModelo } from "./modelo.mjs";

/**
 * Decide se os resultados permitem uma CONCLUSAO comparativa. O criterio e
 * deliberadamente conservador.
 */
export function avaliarComparabilidade(resultados, opcoes = {}) {
  const {
    modeloGlobal = "",
    minCiclosValidos = 2,
    minAmostrasEstatisticas = 10,
    exigirQualidade = true,
    exigirMultiplasVariantes = true,
  } = opcoes;
  const problemas = [];
  const limitacoesEstatisticas = [];
  const porVariante = [];

  if (exigirMultiplasVariantes && resultados.length < 2) {
    problemas.push("menos de duas variantes selecionadas: nao ha comparacao a fazer");
  }
  if (!String(modeloGlobal).trim()) {
    problemas.push("modelo multimodal nao registrado: use --modelo/--modelo-visao");
  }

  const usoDosEventos = new Map();
  if (exigirQualidade) {
    for (const r of resultados) {
      const lista = r.arquivosEventosPorClipe?.length
        ? r.arquivosEventosPorClipe
        : r.arquivoEventos
          ? [{ arquivo: r.arquivoEventos, clipe: null }]
          : [];
      const clipesPorArquivo = new Map();
      for (const uso of lista) {
        const abs = path.resolve(ROOT, uso.arquivo);
        const registro = usoDosEventos.get(abs) ?? { variantes: new Set(), clipes: new Set() };
        registro.variantes.add(r.variante.letra);
        if (uso.clipe) registro.clipes.add(uso.clipe);
        usoDosEventos.set(abs, registro);
        const clipes = clipesPorArquivo.get(abs) ?? new Set();
        if (uso.clipe) clipes.add(uso.clipe);
        clipesPorArquivo.set(abs, clipes);
      }
      for (const [arquivo, clipes] of clipesPorArquivo) {
        if (clipes.size > 1) {
          problemas.push(
            `${r.variante.letra}: mesmo arquivo de eventos reutilizado por varios clipes: ${path.relative(ROOT, arquivo)}`
          );
        }
      }
    }
  }
  for (const [arquivo, uso] of usoDosEventos) {
    if (uso.variantes.size > 1) {
      problemas.push(
        `arquivo de eventos compartilhado por ${[...uso.variantes].join(", ")}: ${path.relative(ROOT, arquivo)} — grave um arquivo por variante e clipe`
      );
    }
  }

  const donoDaSessao = new Map();
  for (const r of resultados) {
    for (const reg of r.registros ?? []) {
      const chave = `${reg.sessionId ?? "?"}/${reg.cycleId ?? "?"}`;
      const dono = donoDaSessao.get(chave);
      if (dono && dono !== r.variante.letra) {
        problemas.push(`ciclo ${chave} aparece nas variantes ${dono} e ${r.variante.letra}`);
      } else {
        donoDaSessao.set(chave, r.variante.letra);
      }
    }
  }

  for (const r of resultados) {
    const letra = r.variante.letra;
    const desempenhoValido = r.desempenhoAquecido ?? r.desempenho;
    const concluidos = desempenhoValido?.ciclosConcluidos ?? 0;
    const modelos = [...new Set(r.modelos?.visao ?? [])];
    const problemasDaVariante = [];

    if (concluidos < minCiclosValidos) {
      problemasDaVariante.push(
        `${concluidos} ciclo(s) concluido(s), abaixo do minimo ${minCiclosValidos}`
      );
    }
    if (concluidos < minAmostrasEstatisticas) {
      limitacoesEstatisticas.push(
        `${letra}: ${concluidos} ciclo(s) concluido(s) no regime aquecido, abaixo do minimo estatistico ${minAmostrasEstatisticas}`
      );
    }
    if (!r.arquivoEventos) {
      if (exigirQualidade) problemasDaVariante.push("sem arquivo de eventos");
    }
    if (!modelos.length) {
      problemasDaVariante.push("modelo multimodal nao observado em visao.jsonl (frameIds dos ciclos)");
    } else if (modelos.length > 1) {
      problemasDaVariante.push(`mais de um modelo multimodal observado: [${modelos.join(", ")}]`);
    }
    if (r.sessaoExplicita === false) {
      for (const reg of r.registros ?? []) {
        if (identificarVarianteDoRegistro(reg) !== letra) {
          problemasDaVariante.push(
            `ciclo ${reg.sessionId ?? "?"}/${reg.cycleId ?? "?"} nao corresponde a variante ${letra}`
          );
          break;
        }
      }
    }
    if (exigirQualidade && !r.qualidade?.consolidado) {
      problemasDaVariante.push("sem qualidade consolidada (anotacoes/eventos ausentes ou ilegiveis)");
    }
    if (
      exigirQualidade &&
      r.qualidade?.consolidado &&
      r.qualidade.consolidado.clipes < (r.qualidade.consolidado.clipesEsperados ?? r.qualidade.consolidado.clipes)
    ) {
      problemasDaVariante.push(
        `qualidade parcial: ${r.qualidade.consolidado.clipes}/${r.qualidade.consolidado.clipesEsperados} clipe(s) avaliados`
      );
    }
    if (exigirQualidade && (r.qualidade?.consolidado?.semClassificacaoEscopo ?? 0) > 0) {
      problemasDaVariante.push(
        `${r.qualidade.consolidado.semClassificacaoEscopo} movimento(s) sem classificacao de escopo`
      );
    }

    if (problemasDaVariante.length) {
      problemas.push(...problemasDaVariante.map((p) => `${letra}: ${p}`));
    }
    porVariante.push({
      letra,
      ciclos: desempenhoValido?.ciclos ?? 0,
      ciclosConcluidos: concluidos,
      ciclosCompletos: desempenhoValido?.ciclosCompletos ?? concluidos,
      ciclosIncompletos: desempenhoValido?.ciclosIncompletos ?? 0,
      warmups: r.warmups ?? 0,
      cancelados: desempenhoValido?.cancelados ?? 0,
      ciclosComSubsistemaIndisponivel:
        desempenhoValido?.ciclosComSubsistemaIndisponivel ?? 0,
      modelos,
      qualidade: Boolean(r.qualidade?.consolidado),
      arquivoEventos: r.arquivoEventos ?? null,
      amostrasEstatisticas: concluidos,
      estatisticamenteSuficiente: concluidos >= minAmostrasEstatisticas,
    });
  }

  const verificacaoModelo = verificarMesmoModelo(resultados, modeloGlobal);
  for (const aviso of verificacaoModelo.avisos) problemas.push(`modelo: ${aviso}`);

  const comparavel = problemas.length === 0 && resultados.length > 0;
  const estatisticamenteSuficiente =
    comparavel && limitacoesEstatisticas.length === 0;
  return {
    comparavel,
    estatisticamenteSuficiente,
    conclusivo: comparavel && estatisticamenteSuficiente,
    minCiclosValidos,
    minAmostrasEstatisticas,
    problemas: [...new Set(problemas)],
    limitacoesEstatisticas: [...new Set(limitacoesEstatisticas)],
    porVariante,
    verificacaoModelo,
  };
}
