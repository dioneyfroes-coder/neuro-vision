#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { carregarAnotacao } from "./avaliar-qualidade.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARQUIVO_MANIFESTO = "manifest.json";

/**
 * Resolucao temporal declarada em `revisao.metodo`. `quadro-a-quadro` conta
 * como resolucao fina; `amostragem-manual-1fps` (ou qualquer N fps) e lida
 * numericamente. Metodo sem informacao devolve `null` — nao presume nada.
 */
function taxaAmostragemFps(metodo) {
  if (typeof metodo !== "string" || !metodo.trim()) return null;
  if (/quadro-a-quadro/i.test(metodo)) return Number.POSITIVE_INFINITY;
  const achado = metodo.match(/(\d+(?:[.,]\d+)?)\s*fps/i);
  return achado ? Number(achado[1].replace(",", ".")) : null;
}

/** Movimentos rapidos exigem anotacao melhor que 1 fps. */
function exigeResolucaoFina(evento) {
  return (
    evento?.categoria === "gesto" ||
    /transicao|rapid|gesto/i.test(String(evento?.classe ?? ""))
  );
}

async function lerJson(caminho) {
  return JSON.parse(await readFile(caminho, "utf8"));
}

async function carregarAnotacoes(diretorio, erros, raiz) {
  let arquivos;
  try {
    arquivos = (await readdir(diretorio)).filter(
      (arquivo) => arquivo.endsWith(".json") && arquivo !== ARQUIVO_MANIFESTO
    );
  } catch (erro) {
    erros.push(`nao foi possivel ler ${path.relative(raiz, diretorio)}: ${erro.message}`);
    return [];
  }

  const anotacoes = [];
  for (const arquivo of arquivos.sort()) {
    const caminho = path.join(diretorio, arquivo);
    try {
      anotacoes.push({
        arquivo,
        dados: carregarAnotacao(await lerJson(caminho)),
      });
    } catch (erro) {
      erros.push(`${path.relative(raiz, caminho)}: ${erro.message}`);
    }
  }
  return anotacoes;
}

async function obterHashClipe(raiz, nomeClipe) {
  if (path.basename(nomeClipe) !== nomeClipe) {
    throw new Error(`nome de clipe precisa ser somente o arquivo: ${nomeClipe}`);
  }
  const caminho = path.resolve(raiz, "bench", "videos", nomeClipe);
  const bytes = await readFile(caminho);
  return createHash("sha256").update(bytes).digest("hex");
}

export async function validarConjuntoEval({
  raiz = ROOT,
  diretorioEval = path.resolve(raiz, "bench", "clipes", "eval"),
  diretorioTuning = path.resolve(raiz, "bench", "clipes", "tuning"),
} = {}) {
  const erros = [];
  let manifesto;
  try {
    manifesto = await lerJson(path.join(diretorioEval, ARQUIVO_MANIFESTO));
  } catch (erro) {
    return { valido: false, erros: [`manifesto EVAL: ${erro.message}`], cobertura: [] };
  }
  if (
    !Number.isInteger(manifesto.ocorrenciasMinimasPorClasse) ||
    manifesto.ocorrenciasMinimasPorClasse < 1 ||
    !Number.isInteger(manifesto.clipesNegativosMinimos) ||
    manifesto.clipesNegativosMinimos < 1 ||
    !Array.isArray(manifesto.classes) ||
    manifesto.classes.length === 0 ||
    manifesto.classes.some(
      (item) =>
        !item ||
        typeof item.categoria !== "string" ||
        typeof item.classe !== "string"
    )
  ) {
    return {
      valido: false,
      erros: ["manifesto EVAL invalido: informe classes e minimos positivos"],
      cobertura: [],
    };
  }

  const evals = await carregarAnotacoes(diretorioEval, erros, raiz);
  const tunings = await carregarAnotacoes(diretorioTuning, erros, raiz);
  const nomesTuning = new Set(tunings.map(({ dados }) => dados.clip).filter(Boolean));
  const hashesTuning = new Set();
  for (const nome of nomesTuning) {
    try {
      hashesTuning.add(await obterHashClipe(raiz, nome));
    } catch (erro) {
      erros.push(`tuning/${nome}: ${erro.message}`);
    }
  }

  const alvosManifesto = new Set(
    manifesto.classes.map(({ categoria, classe }) => `${categoria}.${classe}`)
  );
  const hashesEval = new Set();
  for (const { arquivo, dados } of evals) {
    const relativo = path.join("bench", "clipes", "eval", arquivo);
    if (dados.versaoEsquema !== 2) {
      erros.push(`${relativo}: EVAL requer versaoEsquema 2`);
    }
    if (dados.conjunto !== "eval") {
      erros.push(`${relativo}: conjunto deve ser "eval"`);
    }
    if (dados.revisao?.status !== "revisada") {
      erros.push(`${relativo}: anotacao precisa de revisao humana concluida`);
    }
    if (!dados.clip || path.parse(dados.clip).name !== path.parse(arquivo).name) {
      erros.push(`${relativo}: nome do clip nao corresponde ao arquivo de anotacao`);
    }
    if (dados.casoNegativo && dados.eventos.length > 0) {
      erros.push(`${relativo}: casoNegativo nao pode conter eventos positivos`);
    }
    for (const alvo of dados.negativos) {
      if (!alvosManifesto.has(alvo)) {
        erros.push(`${relativo}: alvo negativo fora do manifesto: ${alvo}`);
        continue;
      }
      const [categoria, classe] = alvo.split(".");
      if (dados.eventos.some((evento) => evento.categoria === categoria && evento.classe === classe)) {
        erros.push(`${relativo}: ${alvo} nao pode ser positivo e negativo no mesmo clipe`);
      }
    }

    for (const evento of dados.eventos) {
      if (
        !evento.categoria ||
        !evento.classe ||
        evento.inicioMs === undefined ||
        evento.fimMs === undefined ||
        !evento.visibilidade ||
        !evento.parteEnvolvida ||
        evento.determinavel === undefined
      ) {
        erros.push(`${relativo}: cada evento EVAL precisa dos metadados humanos completos`);
        break;
      }
    }

    // Movimento rapido nao pode ser anotado so a 1 fps: a resolucao nao
    // distingue inicio/fim de gesto ou transicao e inflaria o recall.
    const eventosRapidos = dados.eventos.filter(exigeResolucaoFina);
    if (eventosRapidos.length) {
      const fps = taxaAmostragemFps(dados.revisao?.metodo);
      if (fps === null || fps <= 1) {
        erros.push(
          `${relativo}: evento rapido (${eventosRapidos[0].categoria}.${eventosRapidos[0].classe}) exige anotacao melhor que 1 fps em revisao.metodo`
        );
      }
    }

    try {
      const hash = await obterHashClipe(raiz, dados.clip);
      if (hashesTuning.has(hash) || nomesTuning.has(dados.clip)) {
        erros.push(`${relativo}: clipe tambem pertence ao conjunto tuning`);
      }
      if (hashesEval.has(hash)) {
        erros.push(`${relativo}: clipe duplicado dentro do conjunto eval`);
      }
      hashesEval.add(hash);
    } catch (erro) {
      erros.push(`${relativo}: ${erro.message}`);
    }
  }

  const cobertura = manifesto.classes.map(({ categoria, classe }) => {
    const ocorrencias = evals.reduce(
      (total, { dados }) =>
        total +
        dados.eventos.filter(
          (evento) =>
            evento.determinavel !== false &&
            evento.categoria === categoria &&
            evento.classe === classe
        ).length,
      0
    );
    const negativos = evals.filter(
      ({ dados }) =>
        dados.casoNegativo || dados.negativos.includes(`${categoria}.${classe}`)
    ).length;
    if (ocorrencias < manifesto.ocorrenciasMinimasPorClasse) {
      erros.push(
        `${categoria}.${classe}: ${ocorrencias}/${manifesto.ocorrenciasMinimasPorClasse} ocorrencias`
      );
    }
    return { categoria, classe, ocorrencias, negativos };
  });

  const clipesNegativos = evals.filter(
    ({ dados }) => dados.casoNegativo || dados.negativos.length > 0
  ).length;
  if (clipesNegativos < manifesto.clipesNegativosMinimos) {
    erros.push(
      `clipes negativos: ${clipesNegativos}/${manifesto.clipesNegativosMinimos}`
    );
  }

  return {
    valido: erros.length === 0,
    erros,
    cobertura,
    clipes: evals.length,
    clipesNegativos,
  };
}

async function main() {
  const resultado = await validarConjuntoEval();
  console.log(`EVAL: ${resultado.clipes ?? 0} clipes; negativos: ${resultado.clipesNegativos ?? 0}`);
  for (const item of resultado.cobertura) {
    console.log(
      `  ${item.categoria}.${item.classe}: ${item.ocorrencias} ocorrencias; ${item.negativos} negativos`
    );
  }
  if (resultado.erros.length) {
    console.error("Fase 4 ainda incompleta:");
    for (const erro of resultado.erros) console.error(`  - ${erro}`);
    process.exitCode = 1;
    return;
  }
  console.log("Conjunto EVAL validado.");
}

const executadoDiretamente =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (executadoDiretamente) {
  main().catch((erro) => {
    console.error(`ERRO: ${erro.message}`);
    process.exitCode = 1;
  });
}
