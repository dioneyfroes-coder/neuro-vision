/**
 * Verificação determinística da Fase 6 (validação e manutenção).
 *
 * Não executa modelo, não lê mídia e não inventa dataset. Os manifestos são
 * **opcionais**: sem eles cada seção volta `sem_dados` e o status geral é
 * `INCONCLUSIVO` com precisão/recall/f1/latência/RAM em `N/A`.
 *
 * Uso:
 *   npm run verificar:fase6:nsfw
 *   npm run verificar:fase6:nsfw -- --dataset d.json --anotacao a.json \
 *       --inferencias i.json --descricoes p.json --revisoes r.json \
 *       --pesos w.json [--json]
 *
 * `--anotacao`/`--inferencias` e `--descricoes`/`--revisoes` devem vir em pares;
 * um arquivo sozinho é tratado como ausente para evitar meia-medição.
 */
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validarDatasetNsfw } from "../src/domain/dataset-nsfw.ts";
import { calcularMetricasNsfwPorClasse } from "../src/domain/metricas-nsfw-por-classe.ts";
import {
  avaliarDescricoesHumanasNsfw,
  prepararAmostrasCegasNsfw,
} from "../src/domain/avaliacao-descricoes-humanas.ts";
import { validarProvenienciaPesos } from "../src/domain/proveniencia-pesos.ts";
import {
  auditarArquivosVersionados,
  classificarArquivoNsfw,
} from "../src/domain/auditoria-privacidade.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function lerArgs() {
  const mapa = { json: false };
  const lista = process.argv.slice(2);
  for (let i = 0; i < lista.length; i += 1) {
    const arg = lista[i];
    const proximo = () => lista[++i] ?? "";
    if (arg === "--json") mapa.json = true;
    else if (["--dataset", "--anotacao", "--inferencias", "--descricoes", "--revisoes", "--pesos"].includes(arg)) {
      mapa[arg.slice(2)] = proximo();
    } else if (arg === "--help" || arg === "-h") mapa.ajuda = true;
    else throw new Error(`argumento desconhecido: ${arg}`);
  }
  return mapa;
}

async function lerJson(caminho) {
  return JSON.parse(await readFile(path.resolve(ROOT, caminho), "utf8"));
}

function listaVersionada() {
  try {
    return execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
      .split(/\r?\n/)
      .filter((linha) => linha.trim() !== "");
  } catch {
    return [];
  }
}

/** Função pura: toda entrada é explícita, nenhuma medição é presumida. */
export function gerarRelatorioFase6(entrada = {}) {
  const dataset = validarDatasetNsfw(entrada.dataset?.manifesto, entrada.dataset?.entradas ?? []);
  const metricas = calcularMetricasNsfwPorClasse(
    entrada.metricas?.anotacao,
    entrada.metricas?.inferidas ?? []
  );
  const descricoes =
    Array.isArray(entrada.descricoes?.pares) && Array.isArray(entrada.descricoes?.revisoes)
      ? (() => {
          const { amostras, mapa } = prepararAmostrasCegasNsfw(entrada.descricoes.pares);
          return avaliarDescricoesHumanasNsfw(amostras, mapa, entrada.descricoes.revisoes);
        })()
      : avaliarDescricoesHumanasNsfw([], {}, []);
  const proveniencia = validarProvenienciaPesos(
    entrada.proveniencia?.manifesto,
    entrada.proveniencia?.pesos ?? []
  );
  const privacidade = auditarArquivosVersionados(entrada.arquivosVersionados ?? []);

  const pronto =
    dataset.prontosParaMetricas &&
    metricas.status === "medido" &&
    descricoes.status === "observado" &&
    proveniencia.prontosParaBenchmark;
  const medido = metricas.status === "medido";
  return {
    status: pronto ? "observado" : "INCONCLUSIVO",
    base: pronto ? "manifestos-e-anotacao-revisada" : "sem_dados_reais",
    dataset,
    metricas,
    descricoes,
    proveniencia,
    privacidade,
    medicoes: {
      precisao: medido ? metricas.macro.precisao : null,
      recall: medido ? metricas.macro.recall : null,
      f1: medido ? metricas.macro.f1 : null,
      // Nenhum harness desta fase mede tempo ou memória.
      latenciaMs: null,
      ramMb: null,
    },
    avisos: [
      "contagem de rotulos nao e precisao do sistema em campo",
      "preferencia cega nao e taxa de acerto nem prova de qualidade",
      "auditoria de caminhos nao substitui varredura de segredos no conteudo",
    ],
  };
}

export async function main() {
  const args = lerArgs();
  if (args.ajuda) {
    console.log("Uso: npm run verificar:fase6:nsfw -- [manifestos .json] [--json]");
    return;
  }
  const entrada = {};
  if (args.dataset) {
    const manifesto = await lerJson(args.dataset);
    entrada.dataset = {
      manifesto,
      entradas: Array.isArray(manifesto?.entradas) ? manifesto.entradas : [],
    };
  }
  if (args.anotacao && args.inferencias) {
    entrada.metricas = {
      anotacao: await lerJson(args.anotacao),
      inferidas: await lerJson(args.inferencias),
    };
  }
  if (args.descricoes && args.revisoes) {
    entrada.descricoes = {
      pares: await lerJson(args.descricoes),
      revisoes: await lerJson(args.revisoes),
    };
  }
  if (args.pesos) {
    const manifesto = await lerJson(args.pesos);
    entrada.proveniencia = {
      manifesto,
      pesos: Array.isArray(manifesto?.pesos) ? manifesto.pesos : [],
    };
  }
  entrada.arquivosVersionados = listaVersionada();

  const relatorio = gerarRelatorioFase6(entrada);
  if (args.json) {
    console.log(JSON.stringify(relatorio, null, 2));
    return;
  }
  const na = (valor) => (valor === null || valor === undefined ? "N/A" : valor);
  console.log(`Verificação Fase 6 (validacao e manutencao) — ${relatorio.status}`);
  console.log(
    `Dataset: ${relatorio.dataset.status} ` +
      `(${relatorio.dataset.motivo ?? `${relatorio.dataset.contagem.teste} de teste`})`
  );
  console.log(`Metricas: ${relatorio.metricas.status} (${relatorio.metricas.motivo ?? "anotacao revisada"})`);
  console.log(
    `Descricoes cegas: ${relatorio.descricoes.status} (${relatorio.descricoes.motivo ?? "revisao coletada"})`
  );
  console.log(
    `Proveniencia: ${relatorio.proveniencia.status} (${relatorio.proveniencia.motivo ?? "pesos declarados"})`
  );
  console.log(
    `Privacidade (git ls-files): ${relatorio.privacidade.status} — ` +
      `${relatorio.privacidade.arquivos} arquivo(s), ` +
      `${relatorio.privacidade.caminhosSensiveis.length} caminho(s) sensivel(is)`
  );
  for (const caminho of relatorio.privacidade.caminhosSensiveis) {
    console.log(`  atencao: ${caminho} (${classificarArquivoNsfw(caminho)})`);
  }
  console.log(
    `Medicoes: precisao ${na(relatorio.medicoes.precisao)} · recall ${na(relatorio.medicoes.recall)} · ` +
      `f1 ${na(relatorio.medicoes.f1)} · latencia ${na(relatorio.medicoes.latenciaMs)} · RAM ${na(relatorio.medicoes.ramMb)}`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
