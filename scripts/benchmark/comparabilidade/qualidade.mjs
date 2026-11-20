import { spawn } from "node:child_process";
import { ROOT, SCRIPT_QUALIDADE } from "../constantes.mjs";
import { resolverArquivoEventosDoClipe, resolverSidecarInicioEventos } from "../artefatos.mjs";
import { arredondar, f1 } from "../estatistica.mjs";

/**
 * Roda a QUALIDADE de um clipe (`npm run qualidade -- ... --json`), invocando o
 * mesmo script que o npm chama.
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
