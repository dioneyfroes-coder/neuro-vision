#!/usr/bin/env node

/**
 * Gate de iluminação/oclusão com verdade-base anotada (Fase 7).
 *
 * Executado como `node --import tsx scripts/validar-condicoes.mjs`. Nunca
 * promove rascunho a aceite: anotações não revisadas são ignoradas, o veredito
 * é INCONCLUSIVO e nenhum número de precisão/recall é inventado.
 */

import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  avaliarCondicoes,
  ehCondicaoAlvo,
} from "../src/domain/avaliacao-condicoes.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLASSES = new Set([
  "baixa_confianca",
  "movimento",
  "nova_entidade",
  "desaparecimento",
  "resumo",
  "outro",
]);

function ajuda() {
  console.log(`
Uso: node --import tsx scripts/validar-condicoes.mjs [opcoes]

  --manifest <arquivo>       manifesto (padrao: bench/clipes/oclusao-iluminacao/manifest.json)
  --anotacoes-dir <pasta>    anotacoes .json revisadas (padrao: bench/clipes/oclusao-iluminacao)
  --eventos <arquivo>        JSONL de eventos observados (padrao: campo 'eventos' do manifesto)
  --relatorio <arquivo>      saida JSON (padrao: logs/condicoes/relatorio-<ISO>.json)
  --permitir-inconclusivo    nao falha quando o veredito for INCONCLUSIVO
  --ajuda                    mostra esta ajuda

O manifesto fixa os minimos e as condicoes exigidas. Sem anotacao revisada,
sem ocorrencias suficientes ou sem clipes negativos, o veredito e INCONCLUSIVO.
`);
}

function argumentos(argv) {
  const resultado = {};
  for (let i = 0; i < argv.length; i += 1) {
    const atual = argv[i];
    if (atual === "--ajuda" || atual === "-h") {
      resultado.ajuda = true;
      continue;
    }
    if (atual === "--permitir-inconclusivo") {
      resultado.permitirInconclusivo = true;
      continue;
    }
    if (!atual.startsWith("--") || i + 1 >= argv.length) {
      throw new Error(`argumento invalido: ${atual}`);
    }
    resultado[atual.slice(2)] = argv[++i];
  }
  return resultado;
}

async function lerJson(caminho) {
  return JSON.parse(await readFile(caminho, "utf8"));
}

function caminhoNoRepo(valor) {
  return path.isAbsolute(valor) ? valor : path.resolve(ROOT, valor);
}

function normalizarAnotacao(dados, origem, avisos) {
  if (dados.versaoEsquema !== 1) {
    avisos.push(`${origem}: versaoEsquema diferente de 1`);
  }
  const eventos = [];
  for (const evento of dados.eventos ?? []) {
    const condicao = evento.condicao;
    if (!ehCondicaoAlvo(String(condicao))) {
      avisos.push(`${origem}: condicao ignorada: ${String(condicao)}`);
      continue;
    }
    const inicioMs = Number.isFinite(evento.inicioMs) ? evento.inicioMs : Number(evento.em);
    const fimMs = Number.isFinite(evento.fimMs)
      ? evento.fimMs
      : Number.isFinite(evento.em)
        ? evento.em
        : inicioMs;
    if (!Number.isFinite(inicioMs) || !Number.isFinite(fimMs)) {
      avisos.push(`${origem}: evento ${condicao} sem tempo valido`);
      continue;
    }
    eventos.push({
      condicao,
      inicioMs,
      fimMs: Math.max(fimMs, inicioMs),
      determinavel: evento.determinavel,
      visibilidade: evento.visibilidade,
    });
  }
  return {
    clip: String(dados.clip ?? path.basename(origem, ".json")),
    duracaoMs: Number(dados.duracaoMs) || 0,
    revisada: dados.revisao?.status === "revisada",
    metodoRevisao: dados.revisao?.metodo,
    eventos,
  };
}

async function carregarAnotacoes(diretorio, avisos) {
  let arquivos;
  try {
    arquivos = (await readdir(diretorio))
      .filter((nome) => nome.endsWith(".json") && nome !== "manifest.json")
      .sort();
  } catch (erro) {
    avisos.push(`nao foi possivel ler ${path.relative(ROOT, diretorio)}: ${erro.message}`);
    return [];
  }
  const anotacoes = [];
  for (const arquivo of arquivos) {
    const caminho = path.join(diretorio, arquivo);
    try {
      anotacoes.push(normalizarAnotacao(await lerJson(caminho), caminho, avisos));
    } catch (erro) {
      avisos.push(`${path.relative(ROOT, caminho)}: ${erro.message}`);
    }
  }
  return anotacoes;
}

async function carregarEventos(caminho, avisos) {
  if (!caminho) return [];
  let conteudo;
  try {
    conteudo = await readFile(caminhoNoRepo(caminho), "utf8");
  } catch (erro) {
    avisos.push(`eventos: ${erro.message}`);
    return [];
  }
  const eventos = [];
  for (const [indice, linha] of conteudo.split(/\r?\n/).entries()) {
    if (!linha.trim()) continue;
    try {
      const bruto = JSON.parse(linha);
      const classeOriginal = bruto.classe ?? bruto.motivo;
      const classe = CLASSES.has(classeOriginal) ? classeOriginal : "outro";
      if (classe !== classeOriginal) avisos.push(`eventos linha ${indice + 1}: classe normalizada para 'outro'`);
      const emMs = Number(bruto.emMs ?? bruto.em);
      if (!Number.isFinite(emMs) || !bruto.clip) {
        avisos.push(`eventos linha ${indice + 1}: clip/emMs invalidos`);
        continue;
      }
      eventos.push({
        clip: String(bruto.clip),
        classe,
        emMs,
        inicioMs: Number.isFinite(bruto.inicioMs) ? bruto.inicioMs : undefined,
        fimMs: Number.isFinite(bruto.fimMs) ? bruto.fimMs : undefined,
        motivo: bruto.motivo,
      });
    } catch (erro) {
      avisos.push(`eventos linha ${indice + 1}: ${erro.message}`);
    }
  }
  return eventos;
}

async function main() {
  const args = argumentos(process.argv.slice(2));
  if (args.ajuda) {
    ajuda();
    return;
  }

  const manifestoPath = caminhoNoRepo(
    args.manifest ?? "bench/clipes/oclusao-iluminacao/manifest.json"
  );
  let manifesto;
  try {
    manifesto = await lerJson(manifestoPath);
  } catch (erro) {
    console.error(`manifesto: ${erro.message}`);
    process.exitCode = 1;
    return;
  }

  const diretorioAnotacoes = caminhoNoRepo(
    args["anotacoes-dir"] ?? "bench/clipes/oclusao-iluminacao"
  );
  const avisos = [];
  const anotacoes = await carregarAnotacoes(diretorioAnotacoes, avisos);
  const eventos = await carregarEventos(
    args.eventos ?? manifesto.eventos ?? "logs/condicoes/eventos.jsonl",
    avisos
  );

  const condicoes = Array.isArray(manifesto.condicoes)
    ? manifesto.condicoes.filter((condicao) => ehCondicaoAlvo(String(condicao)))
    : undefined;
  if (condicoes && condicoes.length === 0) {
    avisos.push("manifesto: nenhuma condicao alvo valida");
  }

  const resultado = avaliarCondicoes(anotacoes, eventos, {
    condicoes,
    ocorrenciasMinimas: manifesto.ocorrenciasMinimasPorCondicao,
    clipesNegativosMinimos: manifesto.clipesNegativosMinimos,
    sobreposicaoMinima: manifesto.sobreposicaoMinima,
    toleranciaMs: manifesto.toleranciaMs,
    maxFalsosPositivosPorMinuto: manifesto.maxFalsosPositivosPorMinuto,
    minPrecisao: manifesto.minPrecisao,
    minRecall: manifesto.minRecall,
  });

  const relatorioPath = caminhoNoRepo(
    args.relatorio ??
    `logs/condicoes/relatorio-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
  );
  await mkdir(path.dirname(relatorioPath), { recursive: true });
  await writeFile(
    relatorioPath,
    JSON.stringify(
      {
        data: new Date().toISOString(),
        manifesto: path.relative(ROOT, manifestoPath),
        anotacoes: anotacoes.map((anotacao) => ({
          clip: anotacao.clip,
          revisada: anotacao.revisada,
          metodoRevisao: anotacao.metodoRevisao,
          eventos: anotacao.eventos.length,
        })),
        eventosObservados: eventos.length,
        veredito: resultado.veredito,
        problemas: resultado.problemas,
        avisos,
        porCondicao: resultado.porCondicao,
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  console.log(`condicoes: ${resultado.veredito}`);
  for (const problema of resultado.problemas) console.log(`  - ${problema}`);
  for (const aviso of avisos) console.log(`  aviso: ${aviso}`);
  console.log(`relatorio: ${path.relative(ROOT, relatorioPath)}`);

  if (resultado.veredito === "REPROVADO") process.exitCode = 1;
  if (resultado.veredito === "INCONCLUSIVO" && !args.permitirInconclusivo) process.exitCode = 1;
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
