import { montarAmbiente } from "../benchmark.mjs";
import { validarConjuntoEval } from "../validar-eval.mjs";
import path from "node:path";
import { lerArgs } from "./args.mjs";
import { ROOT, USO, VARIANTES_BENCHMARK } from "./constantes.mjs";
import { dataHoraCurta, f1, num, pct } from "./estatistica.mjs";
import { descobrirClipes, extrairModelosDoJsonl, filtrarCiclosDaVariante, lerCiclos, modelosDosFrames, resolverArquivoCiclos, resolverArquivoEventos, resolverArquivoEventosDoClipe } from "./artefatos.mjs";
import { agregarEtapasIsoladas, agregarMetricasCiclos, avaliarGateQualidade, separarWarmupCiclos } from "./metricas.mjs";
import { avaliarComparabilidade, avaliarQualidadeDaVariante, verificarMesmoModelo } from "./comparabilidade.mjs";
import { definirToleranciaRelatorio, gerarComparativo, gerarRelatorioVariante, gravarRelatorioSeguro } from "./relatorio.mjs";

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/** URL do backend sem credenciais, para relatorios versionaveis. */
export function backendSeguro(valor) {
  if (!valor) return "http://localhost:1234 (padrao do servidor)";
  try {
    const url = new URL(valor);
    url.username = "";
    url.password = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return String(valor);
  }
}

export async function main() {
  const args = lerArgs();
  if (args.help) {
    console.log(USO);
    return;
  }
  definirToleranciaRelatorio(args.tolerancia);
  const data = args.data || dataHoraCurta();
  const ambiente = montarAmbiente();
  const avisos = [];
  const inicioEm = new Date().toISOString();
  const inicioMs = Date.now();
  const backend = backendSeguro(process.env.NEURO_BASE_URL);
  Object.assign(ambiente, {
    inicioEm,
    backend,
    minCiclosValidos: args.minCiclos,
    minAmostrasEstatisticas: args.minAmostrasEstatisticas,
    warmups: args.warmups,
    etapasIsoladas: args.etapasIsoladas,
    conjunto: args.conjunto,
    criteriosQualidade: args.criteriosQualidade,
    semQualidade: args.semQualidade,
  });

  const variantes = VARIANTES_BENCHMARK.filter((v) => args.variantes.includes(v.letra));
  const modeloGlobal = args.modeloVisao ?? process.env.NEURO_MODELO_VISAO ?? "";

  if (args.conjunto === "eval") {
    const diretorioEval = path.resolve(ROOT, "bench", "clipes", "eval");
    const diretorioVideos = path.resolve(ROOT, "bench", "videos");
    if (
      !args.anotacoesDir ||
      path.resolve(ROOT, args.anotacoesDir) !== diretorioEval ||
      path.resolve(ROOT, args.clipesDir) !== diretorioVideos ||
      args.clipes.length > 0
    ) {
      console.error(
        "ERRO: eval exige o conjunto completo de bench/videos e --anotacoes-dir bench/clipes/eval."
      );
      process.exitCode = 1;
      return;
    }
    const gateEval = await validarConjuntoEval();
    if (!gateEval.valido) {
      console.error("ERRO: conjunto EVAL nao passou pelo gate da Fase 4:");
      for (const erro of gateEval.erros) console.error(`  - ${erro}`);
      process.exitCode = 1;
      return;
    }
  }

  const clipes = await descobrirClipes(
    args.clipesDir,
    args.clipes,
    args.anotacoesDir,
    args.conjunto === "eval"
  );
  if (!clipes.length) {
    console.error(
      `ERRO: nenhum clipe encontrado em ${args.clipesDir || args.clipes.join(", ")}. Use --clipes-dir ou --clipes.`
    );
    process.exit(1);
  }

  console.log(`Clipes (${clipes.length}): ${clipes.map((c) => c.nome).join(", ")}`);
  const semAnotacao = clipes.filter((c) => !c.anotacao);
  if (semAnotacao.length) {
    avisos.push(`sem anotação (<clipe>.json) para: ${semAnotacao.map((c) => c.nome).join(", ")} — qualidade parcial`);
    console.log(`ATENCAO: sem anotacao para ${semAnotacao.map((c) => c.nome).join(", ")}`);
  }
  console.log(`Variantes: ${variantes.map((v) => v.letra).join(", ")} | modelo: ${modeloGlobal || "(nao informado)"}\n`);

  const resultados = [];
  for (const variante of variantes) {
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

    resultados.push({
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
    });
    console.log("");
  }

  // Garantia de mesmo modelo multimodal em todas as variantes (item [1]).
  // Os avisos entram no veredito de comparabilidade abaixo (evita duplicacao).
  const verificacaoModelo = verificarMesmoModelo(resultados, modeloGlobal);

  // 3. Veredito de comparabilidade ANTES de gravar: uma rodada sem ciclos
  //    concluidos, sem modelo verificado ou com eventos compartilhados nao pode
  //    produzir conclusao. Com --warmups, a contagem usa o regime AQUECIDO: o
  //    aquecimento nao vale como amostra para decidir arquitetura.
  const comparabilidade = avaliarComparabilidade(resultados, {
    modeloGlobal,
    minCiclosValidos: args.minCiclos,
    minAmostrasEstatisticas: args.minAmostrasEstatisticas,
    exigirQualidade: !args.semQualidade,
  });
  for (const p of comparabilidade.problemas) avisos.push(`comparabilidade: ${p}`);
  for (const l of comparabilidade.limitacoesEstatisticas) avisos.push(`estatistica: ${l}`);

  // 3b. Gate de qualidade x latencia (Fase 5, itens 5 e 6). Independente do
  //     veredito de comparabilidade: diz se C/D podem ser promovidas a padrao
  //     ou devem permanecer experimentais com estes dados.
  const gateQualidade = avaliarGateQualidade(resultados, args.criteriosQualidade);
  if (!args.semQualidade) {
    for (const g of gateQualidade.porVariante) {
      console.log(
        `  gate ${g.letra}: ${g.promovivel ? "PROMOVIVEL a padrao" : "manter experimental"}${g.motivo ? ` — ${g.motivo}` : ""}`
      );
    }
  }

  const fimEm = new Date().toISOString();
  const duracaoMs = Date.now() - inicioMs;
  Object.assign(ambiente, { fimEm, duracaoMs });

  // 4. Relatorios por variante + consolidado.
  const gravados = [];
  if (!args.semRelatorio) {
    for (const result of resultados) {
      const {
        variante,
        qualidade,
        arquivoEventos,
        arquivosEventosPorClipe,
        arquivoCiclos,
        modelos,
      } = result;
      const avisosDaVariante = [
        ...new Set([
          ...avisos.filter((a) => a.startsWith(`${variante.letra}:`)),
          ...comparabilidade.problemas.filter((p) => p.startsWith(`${variante.letra}:`)),
          ...comparabilidade.limitacoesEstatisticas.filter((p) =>
            p.startsWith(`${variante.letra}:`)
          ),
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
      const cmp = gerarComparativo({
        variantes,
        resultados,
        clipes,
        modelo: modeloGlobal,
        verificacaoModelo,
        comparabilidade,
        gateQualidade,
        ambiente,
        data,
        avisos,
      });
      const alvoCmp = await gravarRelatorioSeguro(args.saida, cmp.nome, cmp.conteudo);
      gravados.push(alvoCmp);
      console.log(`Comparativo gravado: ${path.relative(ROOT, alvoCmp)}\n`);
    } else {
      console.log(
        "Comparativo NAO gravado: a rodada nao e comparavel " +
          "(use --permitir-inconclusivo para gravar um diagnostico marcado como INCONCLUSIVO).\n"
      );
    }
  }

  // Resumo no console (compativel com qualquer shell).
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
          execucao: {
            inicioEm,
            fimEm,
            duracaoMs,
            backend,
            codigo: ambiente.codigo,
            minCiclosValidos: args.minCiclos,
            minAmostrasEstatisticas: args.minAmostrasEstatisticas,
            warmups: args.warmups,
            etapasIsoladas: args.etapasIsoladas,
            conjunto: args.conjunto,
            semQualidade: args.semQualidade,
          },
          data,
          clipes: clipes.map((c) => ({
            nome: c.nome,
            caminho: c.caminho,
            anotacao: c.anotacao,
            tamanhoBytes: c.tamanhoBytes,
            sha256: c.sha256,
          })),
          modelo: modeloGlobal || undefined,
          conclusivo: comparabilidade.conclusivo,
          comparabilidade,
          gateQualidade,
          gravados: gravados.map((g) => path.relative(ROOT, g)),
          avisos,
          resultados: resultados.map(
            ({
              variante,
              desempenho,
              desempenhoAquecido,
              coldStart,
              warmups,
              etapasIsoladas,
              qualidade,
              arquivoEventos,
              arquivosEventosPorClipe,
              arquivoCiclos,
              modelos,
              sessaoExplicita,
            }) => ({
              variante: variante.letra,
              modo: variante.modo,
              configuracao: {
                imagens: variante.imagens,
                percepcaoLocal: variante.percepcaoLocal,
                dadosLocais: variante.dadosLocais,
                temporal: variante.temporal,
              },
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
            })
          ),
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
