/**
 * Harness de comparação dos perfis de descrição corporal (Fase 2 do plano NSFW).
 *
 * Sem argumentos, compara deterministicamente os blocos de prompt SFW, neutro e
 * NSFW gerados a partir das MESMAS marcações sintéticas — nenhum modelo é
 * executado e nenhuma imagem é lida. Com `--anotacao` e `--respostas`, compara
 * descrições já coletadas com anotação humana revisada.
 *
 * Uso:
 *   npm run avaliar:corpo [-- --json]
 *   npm run avaliar:corpo -- --anotacao bench/.../anotacao.json \
 *     --respostas logs/respostas-corpo.jsonl [--json]
 *
 * Acurácia/precisão/recall são N/A por princípio: prompts não são medição de
 * modelo e, sem anotação revisada, omissões/sexualização não são divulgadas.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compararPerfisCorpo, compararPromptsCorpo } from "../src/domain/avaliacao-perfis-corpo.ts";
import { ROOT } from "./avaliar-qualidade/constantes.mjs";

function lerArgs() {
  const mapa = { respostas: "logs/respostas-corpo.jsonl", json: false };
  const lista = process.argv.slice(2);
  for (let i = 0; i < lista.length; i += 1) {
    const arg = lista[i];
    const proximo = () => lista[++i] ?? "";
    if (arg === "--anotacao") mapa.anotacao = proximo();
    else if (arg === "--respostas") mapa.respostas = proximo();
    else if (arg === "--json") mapa.json = true;
    else if (arg === "--help" || arg === "-h") mapa.ajuda = true;
    else throw new Error(`argumento desconhecido: ${arg}`);
  }
  return mapa;
}

async function lerJson(caminho) {
  return JSON.parse(await readFile(path.resolve(ROOT, caminho), "utf8"));
}

async function lerJsonl(caminho) {
  const texto = await readFile(path.resolve(ROOT, caminho), "utf8");
  return texto
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter(Boolean)
    .map((linha, indice) => {
      try {
        return JSON.parse(linha);
      } catch (erro) {
        throw new Error(`linha ${indice + 1} de ${caminho} não é JSON válido: ${erro.message}`);
      }
    });
}

/** Marcações sintéticas apenas para fixar o contrato dos prompts; sem imagem real. */
const QUADROS_EXEMPLO = [
  {
    indice: 1,
    marcacoes: [
      {
        rotulo: "male_breast_exposed",
        score: 0.62,
        caixa: { xmin: 0.1, ymin: 0.2, xmax: 0.5, ymax: 0.8 },
      },
    ],
  },
];

export async function main() {
  const args = lerArgs();
  if (args.ajuda) {
    console.log(
      "Uso: npm run avaliar:corpo [-- --json] | npm run avaliar:corpo -- --anotacao <arquivo.json> --respostas <arquivo.jsonl> [--json]"
    );
    return;
  }

  const prompts = compararPromptsCorpo(QUADROS_EXEMPLO);
  const relatorio = {
    prompts: {
      tamanhos: prompts.tamanhos,
      blocosDistintos: prompts.blocosDistintos,
      neutroContemInstrucaoNsfw: prompts.neutroContemInstrucaoNsfw,
      neutroContemInstrucaoCorporal: prompts.neutroContemInstrucaoCorporal,
      blocos: prompts.blocos,
    },
    acuracia: {
      status: "N/A",
      motivo:
        "comparação de prompts não mede modelo; são necessárias imagens reais e anotação humana revisada",
    },
  };

  if (args.anotacao) {
    const anotacao = await lerJson(args.anotacao);
    const respostas = await lerJsonl(args.respostas);
    const anotacoes = Array.isArray(anotacao) ? anotacao : [anotacao];
    relatorio.descricoes = compararPerfisCorpo(anotacoes, respostas);
  }

  if (args.json) {
    console.log(JSON.stringify(relatorio, null, 2));
    return;
  }

  console.log("Comparação de prompts corporais (mesmas marcações sintéticas)");
  for (const perfil of ["sfw", "neutro", "nsfw"]) {
    console.log(`  ${perfil}: ${prompts.tamanhos[perfil]} caracteres de bloco`);
  }
  console.log(`Blocos distintos: ${prompts.blocosDistintos}`);
  console.log(`Neutro contém instrução NSFW: ${prompts.neutroContemInstrucaoNsfw}`);
  console.log(`Neutro contém instrução corporal: ${prompts.neutroContemInstrucaoCorporal}`);
  console.log(`Acurácia: N/A — ${relatorio.acuracia.motivo}`);
  if (relatorio.descricoes) {
    const d = relatorio.descricoes;
    console.log(`Descrições: ${d.status}${d.motivo ? ` — ${d.motivo}` : ""}`);
    if (d.status === "avaliado") {
      for (const perfil of ["sfw", "neutro", "nsfw"]) {
        const m = d.porPerfil[perfil];
        console.log(
          `  ${perfil}: omissões ${m.omissoes}/${m.totalEsperado}; ` +
            `sexualização indevida ${m.sexualizacoesIndevidas}/${m.totalNaoSexual}; sem resposta ${m.semResposta}`
        );
      }
    }
  }
  console.log("Números léxicos não são precisão/recall e não substituem revisão humana.");
}

const caminhoDoModulo = fileURLToPath(import.meta.url);
const executadoDiretamente =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === caminhoDoModulo;

if (executadoDiretamente) {
  main().catch((erro) => {
    console.error(erro.message);
    process.exit(1);
  });
}
