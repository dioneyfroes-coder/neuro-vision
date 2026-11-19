import { spawn } from "node:child_process";
import path from "node:path";
import { ROOT, SCRIPT_QUALIDADE } from "./constantes.mjs";
import { identificarVarianteDoRegistro, resolverArquivoEventosDoClipe, resolverSidecarInicioEventos } from "./artefatos.mjs";
import { arredondar, f1 } from "./estatistica.mjs";

/**
 * Confere se todas as variantes rodaram com a MESMA versao do modelo
 * multimodal, usando SOMENTE `logs/visao.jsonl` (entradas do multimodal ligadas
 * aos ciclos pelo frameId). O campo `modelo` dos eventos e o detector local e
 * nao serve para essa prova. `consistente` e falso se houver qualquer aviso.
 */
export function verificarMesmoModelo(resultados, modeloGlobal) {
  const porVariante = resultados.map(({ variante, modelos }) => ({
    letra: variante.letra,
    modelos: [...new Set(modelos?.visao ?? [])].sort(),
  }));
  const todos = [...new Set(porVariante.flatMap((p) => p.modelos))].sort();
  const avisos = [];
  const comDados = porVariante.filter((p) => p.modelos.length);

  if (comDados.length >= 2) {
    const divergentes = comDados.filter((p) => p.modelos.join("|") !== comDados[0].modelos.join("|"));
    if (divergentes.length) {
      avisos.push(
        `modelos divergentes entre variantes: ${comDados
          .map((p) => `${p.letra}=[${p.modelos.join(", ")}]`)
          .join(" vs ")} — todas as variantes devem rodar com o mesmo modelo`
      );
    }
  }
  if (modeloGlobal) {
    const esperado = modeloGlobal.trim().toLowerCase();
    for (const p of comDados) {
      const fora = p.modelos.filter((m) => m.toLowerCase() !== esperado);
      if (fora.length) {
        avisos.push(
          `variante ${p.letra} registrou modelo diferente do --modelo: [${fora.join(", ")}] vs "${modeloGlobal}"`
        );
      }
    }
  }
  if (!todos.length) {
    avisos.push(
      "nao foi possivel verificar a versao do modelo multimodal (sem campo `modelo` em visao.jsonl para os frames dos ciclos); confirme manualmente que todas as variantes usaram o mesmo modelo"
    );
  }
  return { consistente: avisos.length === 0, modelos: todos, porVariante, avisos };
}

/**
 * Decide se os resultados permitem uma CONCLUSAO comparativa. O criterio e
 * deliberadamente conservador: sem ciclos concluidos, sem modelo multimodal
 * verificado e sem qualidade propria por variante, o harness nao escolhe
 * vencedores.
 *
 * Duas coisas DIFERENTES sao reportadas:
 *   - `comparavel`: os dados sao validos e as variantes podem ser comparadas
 *     (modelo verificado, amostras concluidas, arquivos proprios, qualidade).
 *   - `estatisticamenteSuficiente`: cada variante tem pelo menos
 *     `minAmostrasEstatisticas` ciclos concluidos no regime aquecido, tamanho
 *     minimo para um intervalo de confianca nao trivial da mediana.
 * `conclusivo` exige as duas condições. Uma rodada comparavel com poucos
 * ciclos NAO e chamada de conclusiva: ela e util como diagnostico, nao como
 * prova estatistica.
 *
 * `resultados`: `{ variante, desempenho, desempenhoAquecido, qualidade, arquivoEventos,
 * arquivosEventosPorClipe, arquivoCiclos, registros, sessaoExplicita, modelos }`.
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

  // Cada clipe precisa de seu proprio arquivo/base temporal; arquivos tambem
  // nao podem ser compartilhados entre variantes na mesma comparacao.
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

  // Sessoes nao podem ser reaproveitadas entre variantes.
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
    // Com warm-up separado, a contagem valida e a do regime AQUECIDO (o
    // aquecimento nao serve como amostra para decidir arquitetura).
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
    /** Conclusivo = comparavel E com amostra estatisticamente suficiente. */
    conclusivo: comparavel && estatisticamenteSuficiente,
    minCiclosValidos,
    minAmostrasEstatisticas,
    problemas: [...new Set(problemas)],
    limitacoesEstatisticas: [...new Set(limitacoesEstatisticas)],
    porVariante,
    verificacaoModelo,
  };
}

/**
 * Roda a QUALIDADE de um clipe (`npm run qualidade -- ... --json`), invocando o
 * mesmo script que o npm chama. `spawn` com array de argumentos funciona igual
 * em PowerShell, CMD e shells Unix (sem interpretar o shell do sistema).
 */
export function executarQualidade({ anotacao, eventos, tolerancia, offset, ignorados }) {
  return new Promise((resolve) => {
    const args = [SCRIPT_QUALIDADE, "--anotacao", anotacao, "--eventos", eventos, "--json"];
    if (Number.isFinite(tolerancia)) args.push("--tolerancia", String(tolerancia));
    if (Number.isFinite(offset) && offset !== 0) args.push("--offset", String(offset));
    if (ignorados) args.push("--ignorados", ignorados);

    const filho = spawn(process.execPath, args, { cwd: ROOT, windowsHide: true });
    let stdout = "";
    let stderr = "";
    filho.stdout.on("data", (d) => (stdout += d));
    filho.stderr.on("data", (d) => (stderr += d));
    filho.on("error", (err) => resolve({ ok: false, erro: err.message }));
    filho.on("close", (code) => {
      if (code !== 0) {
        resolve({ ok: false, erro: stderr.trim() || `qualidade terminou com codigo ${code}` });
        return;
      }
      try {
        resolve({ ok: true, dados: JSON.parse(stdout) });
      } catch {
        resolve({ ok: false, erro: `saida de --json ilegivel: ${stdout.slice(0, 200)}` });
      }
    });
  });
}

/** Avalia cada clipe contra o arquivo de eventos correspondente à execução. */
export async function avaliarQualidadeDaVariante(variante, clipes, args) {
  const porClip = [];
  for (const clipe of clipes) {
    if (!clipe.anotacao) {
      porClip.push({ clipe: clipe.nome, pulado: true, motivo: "sem anotacao (<clipe>.json)" });
      continue;
    }
    const eventosDoClipe = await resolverArquivoEventosDoClipe(variante, clipe.nome, args);
    if (!eventosDoClipe) {
      porClip.push({
        clipe: clipe.nome,
        pulado: true,
        motivo: "sem arquivo de eventos para este clipe",
      });
      continue;
    }
    if (args.conjunto === "eval" && !(await resolverSidecarInicioEventos(eventosDoClipe))) {
      porClip.push({
        clipe: clipe.nome,
        pulado: true,
        motivo: "sem sidecar .inicio para alinhar a base temporal deste clipe",
      });
      continue;
    }
    const r = await executarQualidade({
      anotacao: clipe.anotacao,
      eventos: eventosDoClipe,
      tolerancia: args.tolerancia,
      offset: args.offset,
      ignorados: args.ignorados,
    });
    if (!r.ok) {
      porClip.push({ clipe: clipe.nome, pulado: true, motivo: r.erro });
      continue;
    }
    const d = r.dados;
    porClip.push({
      clipe: clipe.nome,
      arquivoEventos: eventosDoClipe,
      precisao: d.precisao,
      recall: d.recall,
      f1: f1(d.precisao, d.recall),
      falsosPositivosPorMinuto: d.falsosPositivosPorMinuto,
      semClassificacaoEscopo: d.semClassificacaoEscopo ?? 0,
      verdadeirosPositivos: d.verdadeirosPositivos,
      falsosPositivos: d.falsosPositivos,
      perdidos: d.perdidos,
      duracaoMs: d.duracaoMs,
      // Proxy de consistencia temporal: distancia media entre o evento real e
      // a deteccao que casou com ele (menor = mais proximo do instante real).
      distanciaMediaMs: Array.isArray(d.correspondencias) && d.correspondencias.length
        ? arredondar(
            d.correspondencias.reduce((s, c) => s + (c.distanciaMs ?? 0), 0) / d.correspondencias.length
          )
        : null,
    });
  }

  const avaliados = porClip.filter((p) => !p.pulado);
  if (!avaliados.length) return { porClip, consolidado: null };
  const clipesEsperados = clipes.filter((clipe) => clipe.anotacao).length;

  // Consolidado por SOMA de TP/FP/FN (nao media de medias).
  const tp = avaliados.reduce((s, a) => s + (a.verdadeirosPositivos ?? 0), 0);
  const fp = avaliados.reduce((s, a) => s + (a.falsosPositivos ?? 0), 0);
  const fn = avaliados.reduce((s, a) => s + (a.perdidos ?? 0), 0);
  const duracaoMs = avaliados.reduce((s, a) => s + (a.duracaoMs ?? 0), 0);
  const semClassificacaoEscopo = avaliados.reduce(
    (s, a) => s + (a.semClassificacaoEscopo ?? 0),
    0
  );
  const precisao = tp + fp > 0 ? tp / (tp + fp) : null;
  const recall = tp + fn > 0 ? tp / (tp + fn) : null;
  const distancias = avaliados.map((a) => a.distanciaMediaMs).filter(Number.isFinite);
  return {
    porClip,
    consolidado: {
      clipes: avaliados.length,
      clipesEsperados,
      precisao,
      recall,
      f1: f1(precisao, recall),
      falsosPositivosPorMinuto: duracaoMs > 0 ? fp / (duracaoMs / 60_000) : null,
      semClassificacaoEscopo,
      verdadeirosPositivos: tp,
      falsosPositivos: fp,
      eventosNaoDetectados: fn,
      eventosEsperados: tp + fn,
      deteccoes: tp + fp,
      duracaoMs,
      distanciaMediaMs: distancias.length
        ? arredondar(distancias.reduce((s, d) => s + d, 0) / distancias.length)
        : null,
    },
  };
}
