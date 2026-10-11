#!/usr/bin/env node

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PROMPT_TEXTO =
  "Escreva em portugues tres frases curtas descrevendo uma cena de escritorio com pessoas e objetos.";
const PROMPT_VISAO =
  "Voce observa um frame de uma webcam. Descreva em portugues, em no maximo 2 frases, o que aparece na cena, mencionando pessoas e objetos principais.";

// Imagem sintetica 1x1 (GIF) usada quando nao ha snapshot disponivel.
const SVG_BASE = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

function lerArgs() {
  const mapa = { model: [], iter: 3, timeout: 120000, numPredict: 256 };
  const lista = process.argv.slice(2);
  for (let i = 0; i < lista.length; i++) {
    const a = lista[i];
    const proximo = () => lista[++i] ?? "";
    if (a === "--host") mapa.host = proximo();
    else if (a === "--model") mapa.model.push(proximo());
    else if (a === "--iter") mapa.iter = Math.max(1, Number(proximo()) || 1);
    else if (a === "--image") mapa.image = proximo();
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

const nsParaMs = (ns) => (typeof ns === "number" ? ns / 1_000_000 : 0);
const nsParaSeg = (ns) => (typeof ns === "number" ? ns / 1_000_000_000 : 0);

async function resolverImagem(caminho) {
  if (caminho) {
    const abs = path.resolve(ROOT, caminho);
    const dados = await readFile(abs);
    return { nome: path.basename(abs), base64: dados.toString("base64") };
  }
  const dir = path.join(ROOT, "logs", "snapshots");
  const arquivos = (await readdir(dir).catch(() => []))
    .filter((f) => /\.(jpg|jpeg|png)$/i.test(f))
    .sort();
  if (!arquivos.length) return null;
  const dados = await readFile(path.join(dir, arquivos[0]));
  return { nome: arquivos[0], base64: dados.toString("base64") };
}

async function listarModelos(host) {
  const resposta = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(10_000) });
  if (!resposta.ok) throw new Error(`Ollama respondeu HTTP ${resposta.status}`);
  const dados = await resposta.json();
  return (dados.models ?? []).map((m) => m.name ?? "").filter((n) => n.length > 0);
}

async function modelosEmMemoria(host) {
  try {
    const resposta = await fetch(`${host}/api/ps`, { signal: AbortSignal.timeout(5_000) });
    if (!resposta.ok) return [];
    const dados = await resposta.json();
    return (dados.models ?? []).map((m) => m.name ?? m.model ?? "").filter((n) => n.length > 0);
  } catch {
    return [];
  }
}

function normalizarNomeModelo(nome) {
  const texto = String(nome ?? "").trim();
  if (!texto) return "";
  const idx = texto.lastIndexOf(":");
  const sufixo = idx === -1 ? "" : texto.slice(idx + 1);
  if (idx === -1 || sufixo.length === 0 || sufixo.includes("/")) {
    return `${texto}:latest`;
  }
  return texto;
}

function mesmoModelo(a, b) {
  const na = normalizarNomeModelo(a);
  const nb = normalizarNomeModelo(b);
  return na.length > 0 && na === nb;
}

async function garantirCarga(host, modelo, timeoutMs) {
  const emMemoria = await modelosEmMemoria(host);
  if (emMemoria.some((m) => mesmoModelo(m, modelo))) {
    return { jaCarregado: true, cargaMs: 0 };
  }
  const inicio = performance.now();
  await chamarGerar(host, modelo, { prompt: "oi", stream: false, numPredict: 1, timeoutMs });
  const cargaMs = performance.now() - inicio;
  for (let i = 0; i < 60; i++) {
    const agora = await modelosEmMemoria(host);
    if (agora.some((m) => mesmoModelo(m, modelo))) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { jaCarregado: false, cargaMs };
}

async function chamarGerar(host, modelo, opcoes) {
  const mensagem = { role: "user", content: opcoes.prompt };
  if (opcoes.base64) mensagem.images = [opcoes.base64];
  const corpo = {
    model: modelo,
    messages: [mensagem],
    stream: opcoes.stream,
    think: false,
    keep_alive: "5m",
    options: { temperature: 0.2, num_predict: opcoes.numPredict },
  };

  const inicio = performance.now();
  const resposta = await fetch(`${host}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(opcoes.timeoutMs),
  });
  if (!resposta.ok) {
    const texto = await resposta.text().catch(() => "");
    throw new Error(`HTTP ${resposta.status}: ${texto.slice(0, 200)}`);
  }

  if (!opcoes.stream) {
    const dados = await resposta.json();
    const inicioMs = performance.now() - inicio;
    return { primeiroMs: inicioMs, mensagens: 1, ...dados };
  }

  if (!resposta.body) throw new Error("Ollama nao retornou corpo de streaming");
  const reader = resposta.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let primeiroMs = 0;
  let contagem = 0;
  let textoUnico = "";
  let pensou = false;
  let final = {};
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const linha = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!linha) continue;
      const evt = JSON.parse(linha);
      const conteudo = evt.message?.content ?? "";
      if (conteudo && !primeiroMs) primeiroMs = performance.now() - inicio;
      textoUnico += conteudo;
      if (evt.message?.thinking) pensou = true;
      contagem++;
      if (evt.done) final = evt;
    }
  }
  reader.releaseLock();
  return { primeiroMs, mensagens: contagem, textoUnico, pensou, ...final };
}

async function executarIteracoes(host, modelo, setup, iter, json, tolerante = false) {
  const resultados = [];
  let ultimoErro = "";
  for (let i = 0; i < iter; i++) {
    try {
      const r = await chamarGerar(host, modelo, { ...setup, stream: true, timeoutMs: 120000 });
      resultados.push(r);
      if (!json) {
        const geracaoSeg = nsParaSeg(r.eval_duration);
        const detalhe = [
          `1a resposta ${arredondar(r.primeiroMs, 0)} ms`,
          `geracao ${arredondar(geracaoSeg > 0 ? r.eval_count / geracaoSeg : 0, 1)} tok/s`,
          `total ${arredondar(nsParaMs(r.total_duration), 0)} ms`,
        ];
        console.log(`    iteracao ${i + 1}/${iter}: ${detalhe.join(" | ")}`);
      }
    } catch (err) {
      ultimoErro = err.message;
      console.error(`    iteracao ${i + 1}/${iter} falhou: ${err.message}`);
      if (iter === 1 && !tolerante) throw err;
    }
  }

  const ok = resultados.filter((r) => Number.isFinite(r.eval_count) && r.eval_count > 0);
  const vazio = {
    modelo,
    geracaoTokS: 0,
    prefillTokS: 0,
    primeiroMs: 0,
    totalMs: 0,
    tokens: 0,
    textoChars: 0,
    intervaloMinSeg: 1,
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

  const geracao = comResposta.map((r) => r.eval_count / nsParaSeg(r.eval_duration));
  const prefill = comResposta.map((r) => {
    const dur = nsParaSeg(r.prompt_eval_duration);
    return dur > 0 ? r.prompt_eval_count / dur : 0;
  });
  const primeiro = comResposta.map((r) => r.primeiroMs);
  const total = comResposta.map((r) => nsParaMs(r.total_duration));
  const tokens = comResposta.map((r) => r.eval_count);
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
  };
}

async function main() {
  const args = lerArgs();
  const host = (args.host ?? process.env.OLLAMA_HOST ?? "http://localhost:11434").replace(/\/+$/, "");
  const iter = args.iter;
  const json = args.json;

  let modelos;
  try {
    modelos = await listarModelos(host);
  } catch (err) {
    console.error(`ERRO: Ollama fora do ar em ${host} (${err.message}).`);
    console.error("Inicie o Ollama antes de rodar o benchmark.");
    process.exit(1);
  }

  if (args.model.length) {
    const faltantes = args.model.filter((m) => !modelos.includes(m));
    if (faltantes.length) {
      console.error(
        `Modelo(s) nao encontrado(s): ${faltantes.join(", ")}. Disponiveis: ${modelos.join(", ") || "(nenhum)"}`
      );
      process.exit(1);
    }
    modelos = args.model;
  }

  const imagem = await resolverImagem(args.image);
  if (!imagem) {
    console.warn(
      "ATENCAO: nenhum snapshot em logs/snapshots e nenhum --image; usando imagem sintetica 1x1 para o teste de visao."
    );
  }
  const imgBase = imagem?.base64 ?? SVG_BASE;
  const promptVisao = args.prompt ?? PROMPT_VISAO;

  if (imagem) console.log(`Imagem usada para visao: logs/snapshots/${imagem.nome}`);
  console.log(`Host: ${host} | iteracoes: ${iter} | num_predict: ${args.numPredict}\n`);

  const linhas = [];

  for (const modelo of modelos) {
    if (!json) console.log(`== ${modelo} ==`);
    const medidas = { modelo };

    if (!json) console.log("  garantindo modelo em memoria...");
    try {
      const carga = await garantirCarga(host, modelo, args.timeout);
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
      host,
      modelo,
      { prompt: PROMPT_TEXTO, numPredict: args.numPredict, timeoutMs: args.timeout },
      iter,
      json
    );

    if (!json) console.log("  visao (com imagem):");
    medidas.visao = await executarIteracoes(
      host,
      modelo,
      { prompt: promptVisao, base64: imgBase, numPredict: args.numPredict, timeoutMs: args.timeout },
      iter,
      json,
      true
    );

    if (!json) {
      const v = medidas.visao;
      if (v.semVisao) {
        console.log(`    AVISO: o modelo nao processa visao (texto puro). Detalhe: ${v.erro}\n`);
      } else if (v.semResposta) {
        console.log(
          `    AVISO: o modelo nao produziu texto (${v.pensou ? "thinking sempre ativo - o Ollama ignorou think:false neste modelo" : "resposta vazia"}). Os numeros acima medem raciocinio, nao descricao.\n`
        );
        console.log(
          "    Sugestao: `ollama pull qwen2.5vl:3b` e rode com OLLAMA_MODEL=qwen2.5vl:3b (modelo de visao nao-pensante).\n"
        );
      } else {
        console.log(
          `    RESULTADO: geracao ${v.geracaoTokS} tok/s | prefill ${v.prefillTokS} tok/s | 1a resposta ${v.primeiroMs} ms | total ${v.totalMs} ms | texto ${v.textoChars} chars | intervalo minimo >= ${v.intervaloMinSeg}s\n`
        );
      }
    }

    linhas.push(medidas);
  }

  if (json) {
    console.log(JSON.stringify({ host, iter, resultados: linhas }, null, 2));
    return;
  }

  console.log("=== Resumo ===");
  console.table(
    linhas.map((l) => {
      const v = l.visao ?? {};
      return {
        modelo: l.modelo,
        "carga inicial (s)": arredondar((l.cargaMs ?? 0) / 1000, 1),
        "responde?": v.semVisao ? "sem visao" : v.semResposta ? "nao (thinking)" : "sim",
        "visao: geracao (tok/s)": v.geracaoTokS,
        "visao: prefill (tok/s)": v.prefillTokS,
        "1a resposta (ms)": v.primeiroMs,
        "total (ms)": v.totalMs,
        "intervalo minimo (s)": v.intervaloMinSeg,
      };
    })
  );
  console.log(
    "\nDefina o intervalo da UI (slider) com valor >= 'intervalo minimo (s)' ou mantenha o ajuste automatico do cliente."
  );
}

main().catch((err) => {
  console.error(`ERRO: ${err.message}`);
  process.exit(1);
});