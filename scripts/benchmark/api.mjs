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

export const mesmoModelo = (a, b) =>
  String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase() &&
  String(a ?? "").trim().length > 0;

/** Modelos instalados/baixados (`/v1/models`). */
export async function listarModelos(baseUrl, apiKey) {
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
export async function memoriaDoModelo(baseUrl, apiKey, modelo) {
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

export async function garantirCarga(baseUrl, apiKey, modelo, timeoutMs) {
  const emMemoria = await modelosEmMemoria(baseUrl, apiKey);
  if (emMemoria.some((m) => mesmoModelo(m, modelo))) {
    return { jaCarregado: true, cargaMs: 0 };
  }
  const inicio = performance.now();
  await chamarGerar(baseUrl, apiKey, modelo, { prompt: "oi", stream: false, timeoutMs });
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

export async function chamarGerar(baseUrl, apiKey, modelo, opcoes) {
  const corpo = {
    model: modelo,
    messages: [{ role: "user", content: montarConteudo(opcoes.prompt, opcoes.base64) }],
    stream: Boolean(opcoes.stream),
    temperature: 0.2,
    top_p: 0.9,
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