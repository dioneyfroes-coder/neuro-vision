import { extrairModelosDoJsonl, filtrarCiclosDaVariante, lerCiclos, modelosDosFrames, resolverArquivoCiclos, resolverArquivoEventos, resolverArquivoEventosDoClipe } from "../artefatos.mjs";
import { agregarEtapasIsoladas, agregarMetricasCiclos, separarWarmupCiclos } from "../metricas.mjs";
import { avaliarQualidadeDaVariante } from "../comparabilidade.mjs";
import { num, pct } from "../estatistica.mjs";

export async function processarVariante({ variante, clipes, args, avisos, modeloGlobal }) {
  console.log(`== Variante ${variante.letra} — ${variante.rotulo} ==`);

  // 1. Desempenho a partir de logs/ciclos.jsonl.
  const arquivoCiclos = await resolverArquivoCiclos(variante, args);
  const { registros, encontrado } = await lerCiclos(arquivoCiclos);
  const daVariante = filtrarCiclosDaVariante(registros, variante.letra, args.sessoesPorVariante[variante.letra]);
  let desempenho = null;
  if (!encontrado) {
    avisos.push(`${variante.letra}: arquivo de ciclos nao encontrado (${arquivoCiclos})`);
    console.log(`  ciclos: ${arquivoCiclos} nao encontrado`);
  } else if (!daVariante.length) {
    avisos.push(
      `${variante.letra}: nenhum ciclo em ${arquivoCiclos} corresponde a esta variante (use --sessao-${variante.letra} <sessionId> ou grave logs com o modo ${variante.modo})`
    );
    console.log(`  ciclos: 0 registros correspondentes em ${arquivoCiclos}`);
  } else {
    desempenho = agregarMetricasCiclos(daVariante);
    console.log(
      `  ciclos: ${desempenho.ciclos} registros (${desempenho.ciclosConcluidos} concluidos) | total mediana ${desempenho.metricas.totalMs.medianaMs ?? "-"} ms | erros ${desempenho.ciclosComErro} | cancelados ${desempenho.cancelados}`
    );
  }

  // 1b. Warm-up x regime aquecido (Fase 5, item 2). Os primeiros `--warmups`
  //     ciclos concluidos sao aquecimento (compilacao/carga de modelo) e ficam
  //     fora das medianas do comparativo; o cold start e medido a parte.
  const { warmup, aquecido } = separarWarmupCiclos(daVariante, args.warmups);
  const desempenhoAquecido = warmup.length ? agregarMetricasCiclos(aquecido) : desempenho;
  const coldStart = warmup.length ? agregarMetricasCiclos(warmup) : null;
  if (warmup.length) {
    console.log(
      `  warm-up: ${warmup.length} ciclo(s) fora das medianas (cold start total ${coldStart.metricas.totalMs.medianaMs ?? "-"} ms) | aquecido ${desempenhoAquecido.ciclosConcluidos} concluido(s)`
    );
  }

  // 1c. Etapas isoladas x ciclo completo (Fase 5, item 3). Deriva das MESMAS
  //     metricas reais; exige `--etapas-isoladas` para entrar no relatorio.
  const etapasIsoladas = args.etapasIsoladas ? agregarEtapasIsoladas(aquecido) : null;
  if (etapasIsoladas) {
    console.log(
      `  etapas isoladas: soma local mediana ${etapasIsoladas.somaLocalMedianaMs ?? "-"} ms | ciclo completo ${etapasIsoladas.totalMedianaMs ?? "-"} ms | ausentes: ${etapasIsoladas.ausentes.join(", ") || "nenhuma"}`
    );
  }

  // 2. Versao do modelo observada NESTA variante. `--modelo-visao` apenas
  //    registra a intencao; o campo `modelo` de visao.jsonl (por frameId do
  //    ciclo) prova o que rodou. O `modelo` dos eventos e o detector local.
  const arquivosEventosPorClipe = (
    await Promise.all(
      clipes.map(async (clipe) => ({
        clipe: clipe.nome,
        arquivo: await resolverArquivoEventosDoClipe(variante, clipe.nome, args),
      }))
    )
  ).filter((uso) => uso.arquivo);
  const arquivoEventos =
    arquivosEventosPorClipe[0]?.arquivo ?? (await resolverArquivoEventos(variante, args));
  const frameIds = daVariante.flatMap((r) => (Array.isArray(r.frameIds) ? r.frameIds : []));
  const modelos = {
    visao: await modelosDosFrames(args.visao, frameIds),
    // Modelo do detector local: informativo, NAO entra na prova do multimodal.
    deteccao: [
      ...new Set(
        (
          await Promise.all(
            arquivosEventosPorClipe.map((uso) => extrairModelosDoJsonl(uso.arquivo))
          )
        ).flat()
      ),
    ].sort(),
  };
  const resumoModelos = [
    modelos.visao.length ? `visao.jsonl [${modelos.visao.join(", ")}]` : null,
    modelos.deteccao.length ? `detector local [${modelos.deteccao.join(", ")}]` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  console.log(`  modelo observado: ${resumoModelos || "(sem campo `modelo` nos logs desta variante)"}`);

  // 3. Qualidade por clipe via npm run qualidade (scripts/avaliar-qualidade.mjs).
  let qualidade = null;
  if (args.semQualidade) {
    console.log("  qualidade: pulada (--sem-qualidade)");
  } else {
    if (!arquivoEventos) {
      avisos.push(
        `${variante.letra}: nenhum arquivo de eventos encontrado (esperado ${args.eventosPorVariante[variante.letra] ?? `logs/eventos-${variante.letra}.jsonl`}, ${args.eventos}) — rode o app sobre o clipe com esta variante antes de avaliar`
      );
      console.log("  qualidade: sem arquivo de eventos");
    } else {
      console.log(
        `  qualidade: avaliando ${clipes.length} clipe(s) com arquivos próprios por clipe quando configurados...`
      );
      qualidade = await avaliarQualidadeDaVariante(variante, clipes, args);
      const c = qualidade.consolidado;
      if (c) {
        console.log(
          `  qualidade: F1 ${pct(c.f1)} | precisao ${pct(c.precisao)} | recall ${pct(c.recall)} | FP/min ${num(c.falsosPositivosPorMinuto)} | nao detectados ${c.eventosNaoDetectados}`
        );
      } else {
        avisos.push(`${variante.letra}: qualidade nao concluiu (sem anotacoes validas ou eventos ilegiveis)`);
        console.log("  qualidade: sem resultado consolidado");
      }
    }
  }

  console.log("");
  return {
    variante,
    desempenho,
    desempenhoAquecido,
    coldStart,
    warmups: warmup.length,
    etapasIsoladas,
    qualidade,
    arquivoEventos,
    arquivosEventosPorClipe,
    arquivoCiclos,
    modelos,
    registros: daVariante,
    sessaoExplicita: Boolean(args.sessoesPorVariante[variante.letra]),
  };
}
