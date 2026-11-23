#!/usr/bin/env node

/**
 * Relatorio consolidado de benchmark da Fase 8.
 *
 * Uma unica entrada (JSONL de ciclos, opcionalmente um relatorio de soak)
 * produz comparacao de variantes A/B/C/D + cadencia efetiva em Markdown ou
 * JSON. Nenhum numero e inventado e nenhuma execucao real e simulada.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lerCiclos } from "./benchmark/artefatos.mjs";
import { ROOT } from "./benchmark/constantes.mjs";
import {
  montarRelatorio,
  nomeRelatorioFase8,
  PADRAO_NOME_RELATORIO,
} from "./relatorio-fase8/nucleo.mjs";

export {
  compararVariantes,
  formatarRelatorio,
  montarRelatorio,
  nomeRelatorioFase8,
  PADRAO_NOME_RELATORIO,
} from "./relatorio-fase8/nucleo.mjs";

const USO = `
Uso: npm run bench:relatorio [opcoes]

  --ciclos <arquivo>   JSONL de RegistroCiclo (padrao: logs/ciclos.jsonl)
  --soak <arquivo>     JSON de relatorio de soak (opcional)
  --saida <dir>        Diretorio do relatorio Markdown (padrao: bench)
  --data <YYYYMMDD>    Data no nome do arquivo (padrao: hoje)
  --min-ciclos <n>     Minimo de ciclos concluidos por variante (padrao: 2)
  --politica <id>      Filtro de politica de cadencia (ex.: benchmark-5fps)
  --fps-alvo <n>       Alvo de FPS da cadencia (padrao: 5)
  --warmups <n>        Ciclos concluidos excluidos como aquecimento (padrao: 0)
  --json               Imprime o resumo estruturado
  --ajuda, -h          Esta ajuda

Saida: bench/RELATORIO_FASE8_YYYYMMDD.md. bench/BASELINE.md nunca e alterado.
Codigo de saida: 0 quando ha dados suficientes; 2 quando INCONCLUSIVO; 1 em erro.
`.trim();

export function lerArgs(argv = process.argv.slice(2)) {
  const opcoes = {
    ciclos: "logs/ciclos.jsonl",
    soak: null,
    saida: "bench",
    data: new Date().toISOString().slice(0, 10).replace(/-/g, ""),
    minCiclos: 2,
    politica: null,
    fpsAlvo: 5,
    warmups: 0,
    json: false,
    ajuda: false,
  };
  const deValor = {
    "--ciclos": "ciclos",
    "--soak": "soak",
    "--saida": "saida",
    "--data": "data",
    "--min-ciclos": "minCiclos",
    "--politica": "politica",
    "--fps-alvo": "fpsAlvo",
    "--warmups": "warmups",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") opcoes.json = true;
    else if (arg === "--ajuda" || arg === "-h") opcoes.ajuda = true;
    else if (deValor[arg]) {
      const valor = argv[i + 1];
      if (valor === undefined) throw new Error(`${arg} requer um valor`);
      opcoes[deValor[arg]] = valor;
      i += 1;
    } else throw new Error(`opcao desconhecida: ${arg}`);
  }
  for (const chave of ["minCiclos", "fpsAlvo", "warmups"]) {
    opcoes[chave] = Number(opcoes[chave]);
    if (!Number.isFinite(opcoes[chave]) || opcoes[chave] < 0) {
      throw new Error(`${chave} deve ser um numero nao negativo`);
    }
  }
  return opcoes;
}

export async function main(argv = process.argv.slice(2)) {
  const opcoes = lerArgs(argv);
  if (opcoes.ajuda) {
    console.log(USO);
    return 0;
  }

  const avisos = [];
  const lido = await lerCiclos(opcoes.ciclos);
  if (!lido.encontrado) avisos.push(`arquivo de ciclos nao encontrado: ${opcoes.ciclos}`);

  let soak = null;
  if (opcoes.soak) {
    try {
      soak = JSON.parse(await readFile(path.resolve(ROOT, opcoes.soak), "utf8"));
    } catch {
      avisos.push(`relatorio de soak nao legivel: ${opcoes.soak}`);
    }
  }

  const resumo = montarRelatorio({
    registros: lido.registros,
    soak,
    fonte: opcoes.ciclos,
    minCiclos: opcoes.minCiclos,
    politica: opcoes.politica,
    fpsAlvo: opcoes.fpsAlvo,
    warmups: opcoes.warmups,
    avisos,
  });

  if (opcoes.json) console.log(JSON.stringify(resumo, null, 2));
  else console.log(resumo.markdown);

  if (opcoes.saida) {
    const nome = nomeRelatorioFase8(opcoes.data);
    const destino = path.resolve(ROOT, opcoes.saida, nome);
    if (!PADRAO_NOME_RELATORIO.test(path.basename(destino))) {
      throw new Error("nome de relatorio invalido; BASELINE.md e imutavel");
    }
    await mkdir(path.dirname(destino), { recursive: true });
    await writeFile(destino, resumo.markdown, "utf8");
    console.error(`Relatorio gravado em ${destino}`);
  }

  return resumo.suficiente ? 0 : 2;
}

const executadoDiretamente =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (executadoDiretamente) {
  main()
    .then((codigo) => {
      process.exitCode = codigo;
    })
    .catch((erro) => {
      console.error(erro instanceof Error ? erro.message : erro);
      process.exitCode = 1;
    });
}
