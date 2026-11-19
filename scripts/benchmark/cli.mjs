import { arredondar, BASE_URL_PADRAO } from "./comum.mjs";
import { lerArgs } from "./opcoes-cli.mjs";
import { montarAmbiente, resolverImagens } from "./ambiente.mjs";
import { mesmoModelo, garantirCarga, listarModelos, memoriaDoModelo } from "./api.mjs";
import { PROMPT_TEXTO, montarPromptVisao, SVG_BASE } from "./prompts.mjs";
import { agregarVisoes, executarIteracoes } from "./resultados.mjs";

export async function main() {
  const args = lerArgs();
  const baseUrl = (
    args.baseUrl ??
    process.env.NEURO_BASE_URL ??
    process.env.LMSTUDIO_URL ??
    BASE_URL_PADRAO
  ).replace(/\/+$/, "");
  const apiKey = args.apiKey ?? process.env.NEURO_API_KEY ?? "";
  const iter = args.iter;
  const json = args.json;

  let modelos;
  try {
    modelos = await listarModelos(baseUrl, apiKey);
  } catch (err) {
    console.error(`ERRO: backend de visao fora do ar em ${baseUrl} (${err.message}).`);
    console.error("Inicie o servidor local do LM Studio (Developer > Start Server) antes de rodar o benchmark.");
    process.exit(1);
  }

  if (args.model.length) {
    const faltantes = args.model.filter((m) => !modelos.some((d) => mesmoModelo(d, m)));
    if (faltantes.length) {
      console.error(
        `Modelo(s) nao encontrado(s): ${faltantes.join(", ")}. Disponiveis: ${modelos.join(", ") || "(nenhum)"}`
      );
      process.exit(1);
    }
    modelos = args.model;
  }
  if (!modelos.length) {
    console.error("Nenhum modelo instalado no backend. Baixe um modelo no LM Studio antes de continuar.");
    process.exit(1);
  }

  const imagens = await resolverImagens(args.image, [
    args.imagesDir,
    "bench/imagens",
    "logs/snapshots",
  ]);
  if (!imagens.length) {
    console.warn(
      "ATENCAO: nenhuma imagem em --image/--images-dir/bench/imagens/logs/snapshots; usando imagem sintetica 1x1 para o teste de visao."
    );
  }
  const conjunto = imagens.length ? imagens : [{ nome: "sintetica-1x1", base64: SVG_BASE }];
  const promptVisao = montarPromptVisao(args.prompt);
  const ambiente = montarAmbiente();

  if (!json && imagens.length) {
    console.log(`Conjunto fixo de imagens (${imagens.length}): ${imagens.map((i) => i.nome).join(", ")}`);
  }
  if (!json) {
    console.log(
      `Backend: ${baseUrl} | modelos: ${modelos.length} | iteracoes: ${iter} | sem teto de tokens de saida no app | inicio: ${ambiente.dataHora}\n`
    );
  }

  const linhas = [];

  for (const modelo of modelos) {
    if (!json) console.log(`== ${modelo} ==`);
    const medidas = { modelo };

    if (!json) console.log("  garantindo modelo em memoria...");
    try {
      const carga = await garantirCarga(baseUrl, apiKey, modelo, args.timeout);
      medidas.cargaMs = Math.round(carga.cargaMs);
      if (!json)
        console.log(
          carga.jaCarregado
            ? "    modelo ja estava em memoria"
            : `    modelo carregado em ${arredondar(carga.cargaMs / 1000, 1)}s`
        );
    } catch (err) {
      console.error(`  falha ao carregar modelo: ${err.message}`);
      linhas.push(medidas);
      continue;
    }

    if (!json) console.log("  texto (sem imagem):");
    medidas.texto = await executarIteracoes(
      baseUrl,
      apiKey,
      modelo,
      { prompt: PROMPT_TEXTO, timeoutMs: args.timeout },
      iter,
      json
    );
    if (!json && medidas.texto.semResposta) {
      console.log(
        `    AVISO: o modelo nao produziu conteudo de texto (${
          medidas.texto.pensou ? "raciocinio sempre ativo" : "resposta vazia"
        }). Nao use este modelo para descricao.\n`
      );
    }

    if (!json) console.log(`  visao (${conjunto.length} imagem(ns)):`);
    medidas.visaoPorImagem = [];
    for (const img of conjunto) {
      const r = await executarIteracoes(
        baseUrl,
        apiKey,
        modelo,
        { prompt: promptVisao, base64: img.base64, timeoutMs: args.timeout },
        iter,
        json,
        true,
        img.nome
      );
      if (!json && r.semResposta) {
        console.log(
          `    ${img.nome}: AVISO sem conteudo (${
            r.pensou ? "raciocinio sempre ativo" : "resposta vazia"
          }); ignorada na mediana.`
        );
      }
      medidas.visaoPorImagem.push({ imagem: img.nome, ...r });
    }
    medidas.visao = agregarVisoes(medidas.visaoPorImagem);

    medidas.memoria = await memoriaDoModelo(baseUrl, apiKey, modelo);

    if (!json) {
      const v = medidas.visao;
      const mem = medidas.memoria;
      const memTexto = mem
        ? ` | memoria ~${arredondar(mem.bytes / 1024 ** 2, 0)} MB (VRAM ~${arredondar(mem.vramBytes / 1024 ** 2, 0)} MB)`
        : "";
      if (v.semVisao) {
        console.log(`    AVISO: o modelo nao processa visao (texto puro). Detalhe: ${v.erro}\n`);
      } else if (v.semResposta) {
        console.log(
          `    AVISO: o modelo nao produziu texto (${v.pensou ? "raciocinio sempre ativo" : "resposta vazia"}). Os numeros acima medem raciocinio, nao descricao.\n`
        );
        console.log(
          "    Sugestao: use um modelo de visao nao-pensante (ex.: qwen2.5-vl-3b-instruct).\n"
        );
      } else {
        console.log(
          `    RESULTADO (mediana entre imagens): geracao ${v.geracaoTokS} tok/s | prefill ${v.prefillTokS} tok/s | 1a resposta ${v.primeiroMs} ms | total ${v.totalMs} ms | inferencias/min ~${v.inferenciasPorMinuto}${memTexto}\n`
        );
      }
    }

    linhas.push(medidas);
  }

  if (json) {
    console.log(
      JSON.stringify(
        {
          ambiente,
          baseUrl,
          iter,
          timeoutMs: args.timeout,
          limiteTokensSaidaAplicacao: null,
          imagens: conjunto.map((i) => i.nome),
          resultados: linhas,
        },
        null,
        2
      )
    );
    return;
  }

  console.log("=== Resumo comparativo ===");
  console.table(
    linhas.map((l) => {
      const t = l.texto ?? {};
      const v = l.visao ?? {};
      const mem = l.memoria;
      return {
        modelo: l.modelo,
        "carga (s)": arredondar((l.cargaMs ?? 0) / 1000, 1),
        "responde?": v.semVisao
          ? "sem visao"
          : !v.comConteudo
            ? "nao (raciocinio)"
            : v.comConteudo < (v.tentativas ?? 0)
              ? `parcial ${v.comConteudo}/${v.tentativas}`
              : "sim",
        "texto: geracao (tok/s)": t.geracaoTokS,
        "visao: geracao (tok/s)": v.geracaoTokS,
        "visao: prefill (tok/s)": v.prefillTokS,
        "1a resposta (ms)": v.primeiroMs,
        "total (ms)": v.totalMs,
        "inferencias/min": v.inferenciasPorMinuto,
        "RAM (MB)": mem ? arredondar(mem.bytes / 1024 ** 2, 0) : "-",
        "VRAM (MB)": mem ? arredondar(mem.vramBytes / 1024 ** 2, 0) : "-",
        "intervalo minimo (s)": v.intervaloMinSeg,
      };
    })
  );
  console.log(
    "\nDefina o intervalo da UI (slider) com valor >= 'intervalo minimo (s)' ou mantenha o ajuste automatico do cliente."
  );
  console.log(
    `Ambiente: ${ambiente.cpu} (${ambiente.nucleosLogicos} nucleos logicos), ${arredondar(ambiente.memoriaTotalBytes / 1024 ** 3, 1)} GB RAM, ${ambiente.plataforma}, Node ${ambiente.node}.`
  );
}