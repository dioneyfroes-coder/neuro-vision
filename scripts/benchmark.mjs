#!/usr/bin/env node

/**
 * Benchmark comparativo de modelos servidos por um backend compativel com a API
 * de "chat completions" (`/v1/chat/completions`, `/v1/models`) do LM Studio,
 * llama.cpp (`llama-server`) ou vLLM.
 *
 * Para cada modelo mede:
 *   - geracao de texto (sem imagem);
 *   - visao (com imagens fixas), agregando a mediana entre imagens;
 *   - tempo ate a primeira resposta, tokens e inferencias por minuto que o
 *     cliente consegue sustentar (respeitando o intervalo minimo).
 *
 * O resultado e uma tabela comparativa, util para escolher o modelo.
 *
 * Exemplos:
 *   node scripts/benchmark.mjs \
 *     --model qwen2.5-vl-3b-instruct --model gemma-4
 *   node scripts/benchmark.mjs --base-url http://127.0.0.1:1235 --images-dir bench/imagens
 *   node scripts/benchmark.mjs --json > bench/resultado.json
 */

import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const BASE_URL_PADRAO = "http://localhost:1234";

const PROMPT_TEXTO =
  "Escreva em portugues tres frases curtas descrevendo uma cena de escritorio com pessoas e objetos.";
const PROMPT_VISAO =
  "Voce observa um frame de uma webcam. Descreva em portugues, em no maximo 2 frases, o que aparece na cena, mencionando pessoas e objetos principais.";

// Imagem sintetica 1x1 (GIF) usada quando nao ha snapshot disponivel.
const SVG_BASE = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

function lerArgs() {
  // 1024 da espaco para modelos de raciocinio ("thinking") escreverem a resposta:
  // com teto pequeno o `content` saiu vazio e o modelo pareceu nao responder.
  const mapa = { model: [], image: [], iter: 3, timeout: 120000, numPredict: 1024 };
  const lista = process.argv.slice(2);
  for (let i = 0; i < lista.length; i++) {
    const a = lista[i];
    const proximo = () => lista[++i] ?? "";
    if (a === "--base-url" || a === "--host") mapa.baseUrl = proximo();
    else if (a === "--api-key") mapa.apiKey = proximo();
    else if (a === "--model") mapa.model.push(proximo());
    else if (a === "--iter") mapa.iter = Math.max(1, Number(proximo()) || 1);
    else if (a === "--image") mapa.image.push(proximo());
    else if (a === "--images-dir") mapa.imagesDir = proximo();
    else if (a === "--prompt") mapa.prompt = proximo();
    else if (a === "--num-predict") mapa.numPredict = Math.max(1, Number(proximo()) || 1);
    else if (a === "--timeout") mapa.timeout = Math.max(1000, Number(proximo()) || 120000);
    else if (a === "--json") mapa.json = true;
  }
  return mapa;
}

function mediana(valores) {
  if (!valores.length) return 0;
  const ordenado = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenado.length / 2);
  return ordenado.length % 2 ? ordenado[meio] : (ordenado[meio - 1] + ordenado[meio]) / 2;
}

function arredondar(n, casas = 1) {
  const fator = 10 ** casas;
  return Math.round(n * fator) / fator;
}

/**
 * Inferencias por minuto sustentaveis pelo modelo, respeitando o ritmo do
 * cliente: cada analise espera `max(total + 500ms, intervalo minimo)`.
 */
export function inferenciasPorMinuto(totalMs, intervaloMinSeg) {
  const espera = Math.max((totalMs ?? 0) + 500, (intervaloMinSeg ?? 1) * 1000);
  return arredondar(60_000 / espera, 1);
}

/**
 * Versao do codigo em execucao: commit, branch e se havia alteracoes locais.
 * Best-effort — fora de um repositorio Git (ou sem `git` no PATH) devolve null.
 */
export function versaoDoCodigo() {
  const git = (...args) =>
    execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  try {
    return {
      commit: git("rev-parse", "HEAD"),
      branch: git("rev-parse", "--abbrev-ref", "HEAD"),
      alteracoesLocais: git("status", "--porcelain").length > 0,
    };
  } catch {
    return null;
  }
}

/**
 * Metadados de ambiente gravados junto a cada benchmark, para que os numeros
 * sejam comparaveis (mesmo hardware, codigo, modelo e configuracoes).
 */
export function montarAmbiente() {
  const cpus = os.cpus();
  return {
    dataHora: new Date().toISOString(),
    node: process.version,
    plataforma: `${os.platform()} ${os.release()}`,
    arquitetura: os.arch(),
    cpu: (cpus[0]?.model ?? "desconhecido").trim(),
    nucleosLogicos: cpus.length,
    memoriaTotalBytes: os.totalmem(),
    codigo: versaoDoCodigo(),
  };
}

/** Resolve o conjunto fixo de imagens: caminhos explicitos ou um dos diretorios. */
export async function resolverImagens(explicitas, dirs = []) {
  const paraObjeto = async (caminho) => {
    const abs = path.resolve(ROOT, caminho);
    const dados = await readFile(abs);
    return { nome: path.basename(abs), base64: dados.toString("base64") };
  };

  if (explicitas?.length) {
    return Promise.all(explicitas.map(paraObjeto));
  }

  for (const pasta of dirs.filter(Boolean)) {
    const absoluta = path.resolve(ROOT, pasta);
    const arquivos = (await readdir(absoluta).catch(() => []))
      .filter((f) => /\.(jpg|jpeg|png)$/i.test(f))
      .sort();
    if (arquivos.length) {
      return Promise.all(arquivos.map((f) => paraObjeto(path.join(pasta, f))));
    }
  }
  return [];
}

/** Separa a base da "versao" (`/v1`) da URL do backend, evitando duplicar. */
function raizApi(baseUrl) {
  const semBarra = String(baseUrl ?? "").replace(/\/+$/, "");
  const m = semBarra.match(/^(.*?)(\/v\d+)$/);
  return m ? { raiz: m[1], versao: m[2] } : { raiz: semBarra, versao: "/v1" };
}

const urlChat = (baseUrl) => {
  const { raiz, versao } = raizApi(baseUrl);
  return `${raiz}${versao}/chat/completions`;
};
const urlModelos = (baseUrl) => {
  const { raiz, versao } = raizApi(baseUrl);
  return `${raiz}${versao}/models`;
};
const urlEmMemoria = (baseUrl) => `${raizApi(baseUrl).raiz}/api/v0/models`;

function cabecalhos(apiKey) {
  const h = { "Content-Type": "application/json" };
  if (apiKey) h.Authorization = `Bearer ${apiKey}`;
  return h;
}

function extrairBase64(imagem) {
  const index = String(imagem).indexOf(",");
  if (index !== -1 && String(imagem).slice(0, index).includes(";base64")) {
    return String(imagem).slice(index + 1);
  }
  return String(imagem);
}

function paraDataUrl(imagem) {
  return String(imagem).startsWith("data:") ? imagem : `data:image/jpeg;base64,${extrairBase64(imagem)}`;
}

/** Conteudo da mensagem: texto puro ou blocos (texto + image_url). */
function montarConteudo(prompt, base64) {
  if (!base64) return prompt;
  return [
    { type: "text", text: prompt },
    { type: "image_url", image_url: { url: paraDataUrl(base64) } },
  ];
}

const mesmoModelo = (a, b) =>
  String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase() &&
  String(a ?? "").trim().length > 0;

/** Modelos instalados/baixados (`/v1/models`). */
async function listarModelos(baseUrl, apiKey) {
  const resposta = await fetch(urlModelos(baseUrl), {
    headers: cabecalhos(apiKey),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resposta.ok) throw new Error(`o backend respondeu HTTP ${resposta.status}`);
  const dados = await resposta.json();
  return (dados?.data ?? []).map((m) => m.id ?? "").filter((n) => n.length > 0);
}

/** Modelos efetivamente em memoria (REST v0 do LM Studio; tolerante a ausencia). */
async function modelosEmMemoria(baseUrl, apiKey) {
  try {
    const resposta = await fetch(urlEmMemoria(baseUrl), {
      headers: cabecalhos(apiKey),
      signal: AbortSignal.timeout(5_000),
    });
    if (!resposta.ok) return [];
    const dados = await resposta.json();
    return (dados?.data ?? dados?.models ?? [])
      .filter((m) => m.state === undefined || m.state === "loaded")
      .map((m) => m.id ?? m.model ?? m.name ?? "")
      .filter((n) => n.length > 0);
  } catch {
    return [];
  }
}

async function memoriaIntrospectavel(baseUrl, apiKey) {
  try {
    const resposta = await fetch(urlEmMemoria(baseUrl), {
      headers: cabecalhos(apiKey),
      signal: AbortSignal.timeout(5_000),
    });
    return resposta.ok;
  } catch {
    return false;
  }
}

/** Memoria ocupada pelo modelo, quando o backend informa (best-effort). */
async function memoriaDoModelo(baseUrl, apiKey, modelo) {
  try {
    const resposta = await fetch(urlEmMemoria(baseUrl), {
      headers: cabecalhos(apiKey),
      signal: AbortSignal.timeout(5_000),
    });
    if (!resposta.ok) return null;
    const dados = await resposta.json();
    const alvo = (dados?.data ?? dados?.models ?? []).find((m) =>
      mesmoModelo(m.id ?? m.model ?? m.name ?? "", modelo)
    );
    if (!alvo) return null;
    const bytes = Number(alvo.sizeBytes ?? alvo.size ?? 0) || 0;
    const vramBytes = Number(alvo.vramBytes ?? alvo.size_vram ?? 0) || 0;
    if (!bytes && !vramBytes) return null;
    return { bytes, vramBytes };
  } catch {
    return null;
  }
}

async function garantirCarga(baseUrl, apiKey, modelo, timeoutMs) {
  const emMemoria = await modelosEmMemoria(baseUrl, apiKey);
  if (emMemoria.some((m) => mesmoModelo(m, modelo))) {
    return { jaCarregado: true, cargaMs: 0 };
  }
  const inicio = performance.now();
  await chamarGerar(baseUrl, apiKey, modelo, { prompt: "oi", stream: false, numPredict: 1, timeoutMs });
  const cargaMs = performance.now() - inicio;
  // So espera confirmacao em memoria se o backend permite consulta-la.
  if (await memoriaIntrospectavel(baseUrl, apiKey)) {
    for (let i = 0; i < 120; i++) {
      const agora = await modelosEmMemoria(baseUrl, apiKey);
      if (agora.some((m) => mesmoModelo(m, modelo))) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  return { jaCarregado: false, cargaMs };
}

/** Estimativa grosseira de tokens quando o backend nao devolve `usage`. */
const estimarTokens = (texto) => Math.max(1, Math.round(String(texto ?? "").length / 4));

async function chamarGerar(baseUrl, apiKey, modelo, opcoes) {
  const corpo = {
    model: modelo,
    messages: [{ role: "user", content: montarConteudo(opcoes.prompt, opcoes.base64) }],
    stream: Boolean(opcoes.stream),
    temperature: 0.2,
    top_p: 0.9,
    max_tokens: opcoes.numPredict,
  };
  if (opcoes.stream) corpo.stream_options = { include_usage: true };

  const inicio = performance.now();
  const resposta = await fetch(urlChat(baseUrl), {
    method: "POST",
    headers: cabecalhos(apiKey),
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(opcoes.timeoutMs),
  });
  if (!resposta.ok) {
    const texto = await resposta.text().catch(() => "");
    throw new Error(`HTTP ${resposta.status}: ${texto.slice(0, 200)}`);
  }

  if (!opcoes.stream) {
    const dados = await resposta.json().catch(() => ({}));
    const totalMs = performance.now() - inicio;
    const mensagem = dados?.choices?.[0]?.message ?? {};
    const texto = typeof mensagem.content === "string" ? mensagem.content : "";
    return {
      primeiroMs: totalMs,
      primeiroDeltaMs: totalMs,
      totalMs,
      tokens: Number(dados?.usage?.completion_tokens) || estimarTokens(texto),
      promptTokens: Number(dados?.usage?.prompt_tokens) || 0,
      textoUnico: texto,
      pensou: Boolean(mensagem.reasoning_content),
    };
  }

  if (!resposta.body) throw new Error("o backend nao retornou corpo de streaming");
  const reader = resposta.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let primeiroMs = 0;
  let primeiroDeltaMs = 0;
  let tokens = 0;
  let promptTokens = 0;
  let recebeuUso = false;
  let textoUnico = "";
  let pensou = false;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const linha = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!linha.startsWith("data:")) continue;
      const dados = linha.slice(5).trim();
      if (!dados || dados === "[DONE]") continue;
      let evt;
      try {
        evt = JSON.parse(dados);
      } catch {
        continue;
      }
      if (typeof evt.error === "string") throw new Error(evt.error);
      const delta = evt?.choices?.[0]?.delta ?? {};
      const conteudo = typeof delta.content === "string" ? delta.content : "";
      const raciocinio = typeof delta.reasoning_content === "string" ? delta.reasoning_content : "";
      // Primeiro token gerado (conteudo OU raciocinio) marca o fim do prefill.
      if (!primeiroDeltaMs && (conteudo || raciocinio)) primeiroDeltaMs = performance.now() - inicio;
      if (conteudo && !primeiroMs) primeiroMs = performance.now() - inicio;
      textoUnico += conteudo;
      if (raciocinio) pensou = true;
      if (typeof evt?.usage?.completion_tokens === "number") {
        tokens = evt.usage.completion_tokens;
        recebeuUso = true;
      }
      if (typeof evt?.usage?.prompt_tokens === "number") promptTokens = evt.usage.prompt_tokens;
    }
  }
  reader.releaseLock();

  const totalMs = performance.now() - inicio;
  if (!primeiroMs) primeiroMs = totalMs;
  if (!primeiroDeltaMs) primeiroDeltaMs = totalMs;
  if (!recebeuUso) tokens = estimarTokens(textoUnico);
  return { primeiroMs, primeiroDeltaMs, totalMs, tokens, promptTokens, textoUnico, pensou };
}

/**
 * Segundos de geracao de um resultado: do primeiro token (conteudo ou
 * raciocinio) ate o fim. Modelo que entrega tudo no ultimo chunk nao separa
 * prefill de geracao no relogio; nesse caso usa o tempo total para nao inflar
 * o tok/s.
 */
export function segundosDeGeracao(r) {
  const deltaMs = r.totalMs - (r.primeiroDeltaMs ?? r.primeiroMs);
  return deltaMs >= 20 ? deltaMs / 1000 : Math.max(r.totalMs / 1000, 0.001);
}

async function executarIteracoes(baseUrl, apiKey, modelo, setup, iter, json, tolerante = false, rotulo = "") {
  const resultados = [];
  let ultimoErro = "";
  const prefixo = rotulo ? `${rotulo} · ` : "";
  for (let i = 0; i < iter; i++) {
    try {
      const r = await chamarGerar(baseUrl, apiKey, modelo, { ...setup, stream: true, timeoutMs: setup.timeoutMs });
      resultados.push(r);
      if (!json) {
        const detalhe = [
          `1a resposta ${arredondar(r.primeiroMs, 0)} ms`,
          `geracao ${arredondar(r.tokens / segundosDeGeracao(r), 1)} tok/s`,
          `total ${arredondar(r.totalMs, 0)} ms`,
        ];
        console.log(`    ${prefixo}iteracao ${i + 1}/${iter}: ${detalhe.join(" | ")}`);
      }
    } catch (err) {
      ultimoErro = err.message;
      console.error(`    ${prefixo}iteracao ${i + 1}/${iter} falhou: ${err.message}`);
      if (iter === 1 && !tolerante) throw err;
    }
  }

  const ok = resultados.filter((r) => Number.isFinite(r.tokens) && r.tokens > 0);
  const vazio = {
    modelo,
    geracaoTokS: 0,
    prefillTokS: 0,
    primeiroMs: 0,
    totalMs: 0,
    tokens: 0,
    textoChars: 0,
    intervaloMinSeg: 1,
    tentativas: iter,
    comConteudo: 0,
  };
  if (!ok.length) {
    if (tolerante) return { ...vazio, semVisao: true, erro: ultimoErro };
    return vazio;
  }

  const comResposta = ok.filter((r) => (r.textoUnico ?? "").length > 0);
  const pensou = ok.some((r) => r.pensou === true);
  if (!comResposta.length) {
    return { ...vazio, pensou, semResposta: true };
  }

  const geracao = comResposta.map((r) => r.tokens / segundosDeGeracao(r));
  const prefill = comResposta.map((r) => {
    const seg = Math.max((r.primeiroDeltaMs ?? r.primeiroMs) / 1000, 0.001);
    return r.promptTokens / seg;
  });
  const primeiro = comResposta.map((r) => r.primeiroMs);
  const total = comResposta.map((r) => r.totalMs);
  const tokens = comResposta.map((r) => r.tokens);
  const chars = comResposta.map((r) => (r.textoUnico ?? "").length);

  const totalMs = mediana(total);
  const intervaloMinSeg = Math.max(1, Math.ceil((totalMs * 1.5) / 1000));

  return {
    modelo,
    geracaoTokS: arredondar(mediana(geracao)),
    prefillTokS: arredondar(mediana(prefill)),
    primeiroMs: arredondar(mediana(primeiro), 0),
    totalMs: arredondar(totalMs, 0),
    tokens: Math.round(mediana(tokens)),
    textoChars: Math.round(mediana(chars)),
    intervaloMinSeg,
    inferenciasPorMinuto: inferenciasPorMinuto(totalMs, intervaloMinSeg),
    tentativas: iter,
    comConteudo: comResposta.length,
  };
}

/** Agrega as medicoes de visao de varias imagens (mediana entre imagens). */
export function agregarVisoes(porImagem) {
  const ok = porImagem.filter((v) => v && !v.semVisao && !v.semResposta && v.geracaoTokS > 0);
  const somar = (campo) => porImagem.reduce((s, v) => s + (v?.[campo] ?? 0), 0);
  const tentativas = somar("tentativas");
  const comConteudo = somar("comConteudo");
  if (!ok.length) {
    const primeiro = porImagem[0];
    if (!primeiro) return {};
    return { ...primeiro, tentativas, comConteudo };
  }
  const med = (campo, casas = 1) => arredondar(mediana(ok.map((v) => v[campo] ?? 0)), casas);
  const totalMs = med("totalMs", 0);
  const intervaloMinSeg = Math.max(1, Math.ceil((totalMs * 1.5) / 1000));
  return {
    ...ok[0],
    geracaoTokS: med("geracaoTokS"),
    prefillTokS: med("prefillTokS"),
    primeiroMs: med("primeiroMs", 0),
    totalMs,
    tokens: Math.round(med("tokens", 0)),
    textoChars: Math.round(med("textoChars", 0)),
    intervaloMinSeg,
    inferenciasPorMinuto: inferenciasPorMinuto(totalMs, intervaloMinSeg),
    imagens: ok.length,
    tentativas,
    comConteudo,
  };
}

async function main() {
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
  const promptVisao = args.prompt ?? PROMPT_VISAO;
  const ambiente = montarAmbiente();

  if (imagens.length) {
    console.log(`Conjunto fixo de imagens (${imagens.length}): ${imagens.map((i) => i.nome).join(", ")}`);
  }
  console.log(
    `Backend: ${baseUrl} | modelos: ${modelos.length} | iteracoes: ${iter} | max_tokens: ${args.numPredict} | inicio: ${ambiente.dataHora}\n`
  );

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
      { prompt: PROMPT_TEXTO, numPredict: args.numPredict, timeoutMs: args.timeout },
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
        { prompt: promptVisao, base64: img.base64, numPredict: args.numPredict, timeoutMs: args.timeout },
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
          numPredict: args.numPredict,
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

const caminhoDoModulo = fileURLToPath(import.meta.url);
const executadoDiretamente =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === caminhoDoModulo;

if (executadoDiretamente) {
  main().catch((err) => {
    console.error(`ERRO: ${err.message}`);
    process.exit(1);
  });
}
