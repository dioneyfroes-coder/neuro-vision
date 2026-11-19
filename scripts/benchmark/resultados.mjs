import { arredondar, inferenciasPorMinuto, mediana } from "./comum.mjs";
import { chamarGerar } from "./api.mjs";

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

export async function executarIteracoes(baseUrl, apiKey, modelo, setup, iter, json, tolerante = false, rotulo = "") {
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