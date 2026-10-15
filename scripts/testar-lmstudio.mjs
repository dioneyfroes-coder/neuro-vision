/**
 * Teste pratico automatico da integracao com o LM Studio (protocolo de chat completions).
 *
 * Percorre o caminho real da aplicacao, do modelo ate a API do servidor:
 *   1. lista os modelos do LM Studio (`/v1/models`);
 *   2. gera um frame de teste (PNG com formas/cores reconheciveis);
 *   3. sobe o servidor `createServer` apontando para o LM Studio em
 *      `NEURO_BASE_URL` (padrao: http://127.0.0.1:1234);
 *   4. consulta `/api/health` e `/api/visao/preparar`;
 *   5. faz um `POST /api/visao` de verdade (stream NDJSON) e valida a descricao.
 *
 * Uso:
 *   LMSTUDIO_URL=http://127.0.0.1:1235 NEURO_MODEL=qwen2.5-vl-3b-instruct \
 *     node scripts/testar-lmstudio.mjs
 */

import zlib from "node:zlib";
import { once } from "node:events";

import {env} from "../src/env.ts";
const BASE = process.env.LMSTUDIO_URL || env.NEURO_BASE_URL || "http://127.0.0.1:1234";
const MODELO = env.NEURO_MODEL;

let falhas = 0;
function ok(nome, extra = "") {
  console.log(`  [ok] ${nome}${extra ? ` -> ${extra}` : ""}`);
}
function falhou(nome, motivo) {
  falhas++;
  console.log(`  [FALHOU] ${nome}: ${motivo}`);
}
function secao(titulo) {
  console.log(`\n== ${titulo} ==`);
}

/** CRC32 (para montar um PNG valido manualmente, sem dependencias). */
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(tipo, dados) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(dados.length, 0);
  const corpo = Buffer.concat([Buffer.from(tipo, "ascii"), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo), 0);
  return Buffer.concat([len, corpo, crc]);
}

/** Gera um PNG RGB (sem filtro) a partir de uma funcao (x,y) -> [r,g,b]. */
function png(largura, altura, pixel) {
  const linhas = [];
  for (let y = 0; y < altura; y++) {
    const linha = Buffer.alloc(1 + largura * 3);
    linha[0] = 0; // filtro "none"
    for (let x = 0; x < largura; x++) {
      const [r, g, b] = pixel(x, y);
      linha[1 + x * 3] = r;
      linha[2 + x * 3] = g;
      linha[3 + x * 3] = b;
    }
    linhas.push(linha);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type = truecolor
  const idat = zlib.deflateSync(Buffer.concat(linhas));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Frame sintetico facil de descrever: fundo azul, um retangulo amarelo grande
 * no centro e uma faixa vermelha na base. Cores/formas inequivocas ajudam a
 * distinguir "descreveu a imagem" de "recusou/aloqueou".
 */
function frameDeTeste() {
  const p = png(320, 240, (x, y) => {
    if (y > 180) return [220, 40, 40]; // base vermelha
    if (x > 100 && x < 220 && y > 70 && y < 170) return [250, 210, 40]; // retangulo amarelo
    return [30, 80, 200]; // fundo azul
  });
  return `data:image/png;base64,${p.toString("base64")}`;
}

async function getJson(url, timeoutMs = 5000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function inicio() {
  console.log(`Teste de integracao Neuro Vision <-> LM Studio`);
  console.log(`Backend: ${BASE}`);

  secao("1. Modelos do LM Studio");
  let modelos = [];
  try {
    const { status, body } = await getJson(`${BASE}/v1/models`);
    if (status !== 200) throw new Error(`HTTP ${status}`);
    modelos = (body?.data ?? []).map((m) => m.id).filter(Boolean);
    if (!modelos.length) throw new Error("lista vazia");
    ok("GET /v1/models", `${modelos.length} modelo(s)`);
    for (const m of modelos) console.log(`       - ${m}`);
  } catch (err) {
    falhou("GET /v1/models", err.message);
    console.log(
      "\n  O LM Studio nao respondeu. Verifique se o 'Local Server' esta ligado e\n" +
        "  se a porta bate com a URL acima (LM Studio: aba 'Developer' > 'Start Server')."
    );
    process.exit(1);
  }

  const alvo =
    MODELO ||
    modelos.find((m) => /qwen2\.?5-vl|vision|llava|gemma\d|minicpm/i.test(m)) ||
    modelos[0];
  console.log(`\n  Modelo escolhido: ${alvo}`);
  const modeloVision = /qwen2\.?5-vl|vision|llava|gemma[0-9-]*|minicpm/i.test(alvo);
  if (!modeloVision) {
    falhou("modelo multimodal", `'${alvo}' nao parece ser um modelo de visao`);
  } else {
    ok("modelo multimodal de visao detectado");
  }

  secao("2. Frame de teste");
  const imagem = frameDeTeste();
  ok("PNG gerado", `${Math.round(imagem.length / 1024)} KB (base64)`);

  secao("3. Servidor da aplicacao (createServer)");
  process.env.NEURO_BASE_URL = BASE;
  process.env.NEURO_MODEL = alvo; // garante prioridade no processo para a instância atual
  const { createServer, LOG_DIR } = await import("../src/server.ts");
  const httpServer = createServer({ backendUrl: BASE });
  httpServer.listen(0, "127.0.0.1");
  await once(httpServer, "listening");
  const { port } = httpServer.address();
  const api = `http://127.0.0.1:${port}`;
  ok("servidor no ar", api);
  console.log(`  (logs em ${LOG_DIR})`);

  try {
    secao("4. GET /api/health");
    try {
      const { body } = await getJson(`${api}/api/health`, 8000);
      const o = body?.visao ?? {};
      if (o.online) {
        ok("backend online", `modelo=${o.modelo}`);
        if (!(o.modelos ?? []).length) falhou("modelos listados", "vazio");
      } else {
        falhou("backend online", o.erro || "offline");
      }
    } catch (err) {
      falhou("GET /api/health", err.message);
    }

    secao("5. GET /api/visao/preparar (carrega o modelo na memoria)");
    try {
      const t0 = Date.now();
      const { status, body } = await getJson(`${api}/api/visao/preparar`, 180000);
      if (status === 200 && body?.ok) {
        ok("modelo preparado", `modelo=${body.modelo} carregado=${body.carregado}`);
      } else {
        falhou("GET /api/visao/preparar", `HTTP ${status} ${body?.erro ?? ""}`);
      }
      console.log(`       (tempo total: ${Math.round((Date.now() - t0) / 1000)}s)`);
    } catch (err) {
      falhou("GET /api/visao/preparar", err.message);
    }

    secao("6. POST /api/visao (stream NDJSON real)");
    try {
      const t0 = Date.now();
      const res = await fetch(`${api}/api/visao`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imagem, modo: "descricao", capturadoEm: new Date().toISOString() }),
        signal: AbortSignal.timeout(180000),
      });
      if (!res.ok) {
        const erro = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${erro.slice(0, 300)}`);
      }
      const texto = await res.text();
      const eventos = texto
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      const chunks = eventos.filter((e) => e.type === "chunk");
      const done = eventos.find((e) => e.type === "done");
      const erro = eventos.find((e) => e.type === "erro");
      if (erro) throw new Error(erro.erro || "erro no stream");
      if (!done) throw new Error("stream sem evento 'done'");

      ok("stream recebido", `${chunks.length} chunk(s), ${Math.round((Date.now() - t0) / 1000)}s`);
      console.log(`       descricao: ${done.descricao}`);
      console.log(`       modelo=${done.modelo} tokens=${done.tokens} ms=${done.ms}`);

      const desc = (done.descricao ?? "").trim();
      if (desc.length < 5) falhou("descricao util", "muito curta/vazia");
      else ok("descricao util", `${desc.length} caracteres`);

      const recusou = /(desculpe|n[ãa]o posso|n[ãa]o tenho (a )?capacidade|n[ãa]o consigo ver)/i.test(desc);
      if (recusou) {
        falhou(
          "sem recusa",
          "o modelo respondeu recusando a imagem (ver nota sobre isso abaixo)"
        );
      } else {
        ok("sem recusa");
      }
    } catch (err) {
      falhou("POST /api/visao", err.message);
    }
  } finally {
    httpServer.close();
  }

  secao("Resultado");
  if (falhas === 0) {
    console.log(`  Integracao OK: a aplicacao falou com ${alvo} via LM Studio.`);
    process.exit(0);
  }
  console.log(`  ${falhas} verificacao(oes) falharam. Veja os detalhes acima.`);
  process.exit(1);
}

inicio().catch((err) => {
  console.error("Erro inesperado:", err);
  process.exit(2);
});
