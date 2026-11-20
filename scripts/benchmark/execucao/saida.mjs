import path from "node:path";
import { ROOT } from "../constantes.mjs";
import { num, pct } from "../estatistica.mjs";
import { definirToleranciaRelatorio, gerarComparativo, gerarRelatorioVariante, gravarRelatorioSeguro } from "../relatorio.mjs";

export async function emitirResultados({ args, variantes, clipes, modeloGlobal, verificacaoModelo, comparabilidade, gateQualidade, ambiente, data, avisos, resultados, inicioEm, fimEm, duracaoMs, backend }) {
  definirToleranciaRelatorio(args.tolerancia);
  const gravados = [];
  if (!args.semRelatorio) {
    for (const result of resultados) {
      const { variante, qualidade, arquivoEventos, arquivosEventosPorClipe, arquivoCiclos, modelos } = result;
      const avisosDaVariante = [
        ...new Set([
          ...avisos.filter((a) => a.startsWith(`${variante.letra}:`)),
          ...comparabilidade.problemas.filter((p) => p.startsWith(`${variante.letra}:`)),
          ...comparabilidade.limitacoesEstatisticas.filter((p) => p.startsWith(`${variante.letra}:`)),
        ]),
      ];
      const conteudo = gerarRelatorioVariante({
        variante,
        clipes,
        desempenho: result.desempenhoAquecido ?? result.desempenho,
        coldStart: result.coldStart,
        warmups: result.warmups,
        etapasIsoladas: result.etapasIsoladas,
        qualidade,
        arquivoEventos,
        arquivosEventosPorClipe,
        arquivoCiclos,
        modelos,
        modelo: args.modeloPorVariante[variante.letra] ?? modeloGlobal,
        gate: gateQualidade.porVariante.find((g) => g.letra === variante.letra) ?? null,
        ambiente,
        avisos: avisosDaVariante,
        data,
      });
      const alvo = await gravarRelatorioSeguro(args.saida, `RELATORIO_VARIANTE_${variante.letra}_${data}.md`, conteudo);
      gravados.push(alvo);
      console.log(`Relatorio gravado: ${path.relative(ROOT, alvo)}`);
    }

    if (comparabilidade.comparavel || args.permitirInconclusivo) {
      const cmp = gerarComparativo({ variantes, resultados, clipes, modelo: modeloGlobal, verificacaoModelo, comparabilidade, gateQualidade, ambiente, data, avisos });
      const alvoCmp = await gravarRelatorioSeguro(args.saida, cmp.nome, cmp.conteudo);
      gravados.push(alvoCmp);
      console.log(`Comparativo gravado: ${path.relative(ROOT, alvoCmp)}\n`);
    } else {
      console.log("Comparativo NAO gravado: a rodada nao e comparavel (use --permitir-inconclusivo para gravar um diagnostico marcado como INCONCLUSIVO).\n");
    }
  }

  const letrasPromoviveis = new Set(gateQualidade.porVariante.filter((g) => g.promovivel).map((g) => g.letra));
  console.table(
    resultados.map(({ variante, desempenhoAquecido, desempenho, coldStart, warmups, qualidade, modelos }) => {
      const valido = desempenhoAquecido ?? desempenho;
      const m = valido?.metricas ?? {};
      const c = qualidade?.consolidado;
      return {
        variante: variante.letra,
        modo: variante.modo,
        modelo: (modelos?.visao ?? []).join(", ") || "-",
        "detector local": (modelos?.deteccao ?? []).join(", ") || "-",
        ciclos: valido?.ciclos ?? 0,
        concluidos: valido?.ciclosConcluidos ?? 0,
        incompletos: valido?.ciclosIncompletos ?? 0,
        warmups: warmups ?? 0,
        "cold start (ms)": coldStart?.metricas.totalMs.medianaMs ?? "-",
        "percepcao 4 snapshots med (ms)": m.percepcaoTotalMs?.medianaMs ?? "-",
        "ate multimodal med (ms)": m.latenciaAteRespostaMultimodalMs?.medianaMs ?? "-",
        "entre ciclos med (ms)": m.latenciaEntreCiclosMs?.medianaMs ?? "-",
        "total med (ms)": m.totalMs?.medianaMs ?? "-",
        "total P95 (ms)": m.totalMs?.p95Ms ?? "-",
        "multimodal med (ms)": m.multimodalMs?.medianaMs ?? "-",
        F1: c ? pct(c.f1) : "-",
        precisao: c ? pct(c.precisao) : "-",
        recall: c ? pct(c.recall) : "-",
        "FP/min": c ? num(c.falsosPositivosPorMinuto) : "-",
        "nao detectados": c ? c.eventosNaoDetectados : "-",
        erros: valido?.ciclosComErro ?? 0,
        cancelados: valido?.cancelados ?? 0,
        "subs. indisponivel": valido?.ciclosComSubsistemaIndisponivel ?? 0,
        gate: args.semQualidade ? "-" : letrasPromoviveis.has(variante.letra) ? "promovivel" : "experimental",
      };
    })
  );

  if (avisos.length) {
    console.log("\nAvisos:");
    for (const a of avisos) console.log(`  - ${a}`);
  }

  console.log(
    comparabilidade.conclusivo
      ? "\nVeredito: CONCLUSAO VALIDA — dados comparaveis e amostra estatisticamente suficiente."
      : comparabilidade.comparavel
        ? "\nVeredito: COMPARAVEL, MAS ESTATISTICAMENTE INSUFICIENTE — use como diagnostico, nao como prova."
        : "\nVeredito: INCONCLUSIVO — corrija os problemas acima antes de decidir entre variantes."
  );

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          ambiente,
          execucao: { inicioEm, fimEm, duracaoMs, backend, codigo: ambiente.codigo, minCiclosValidos: args.minCiclos, minAmostrasEstatisticas: args.minAmostrasEstatisticas, warmups: args.warmups, etapasIsoladas: args.etapasIsoladas, conjunto: args.conjunto, semQualidade: args.semQualidade },
          data,
          clipes: clipes.map((c) => ({ nome: c.nome, caminho: c.caminho, anotacao: c.anotacao, tamanhoBytes: c.tamanhoBytes, sha256: c.sha256 })),
          modelo: modeloGlobal || undefined,
          conclusivo: comparabilidade.conclusivo,
          comparabilidade,
          gateQualidade,
          gravados: gravados.map((g) => path.relative(ROOT, g)),
          avisos,
          resultados: resultados.map(({ variante, desempenho, desempenhoAquecido, coldStart, warmups, etapasIsoladas, qualidade, arquivoEventos, arquivosEventosPorClipe, arquivoCiclos, modelos, sessaoExplicita }) => ({
            variante: variante.letra,
            modo: variante.modo,
            configuracao: { imagens: variante.imagens, percepcaoLocal: variante.percepcaoLocal, dadosLocais: variante.dadosLocais, temporal: variante.temporal },
            sessaoExplicita,
            arquivoCiclos,
            arquivoEventos,
            arquivosEventosPorClipe,
            modelos,
            desempenho,
            desempenhoAquecido,
            coldStart,
            warmups,
            etapasIsoladas,
            gate: gateQualidade.porVariante.find((g) => g.letra === variante.letra) ?? null,
            qualidade,
          })),
          verificacaoModelo,
        },
        null,
        2
      )
    );
  }

  if (!comparabilidade.comparavel && !args.permitirInconclusivo) {
    process.exitCode = 1;
  }
}
