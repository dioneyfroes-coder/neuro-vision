/**
 * Nucleo puro da verificacao de compatibilidade (Fase 8).
 *
 * As versoes dos runtimes carregados do CDN estao repetidas em varios arquivos
 * (cliente, manifesto offline, imports de tipo, alias de teste, package.json).
 * A politica so e util se a divergencia for detectada automaticamente: esta
 * funcao compara as declaracoes e devolve problemas explicitos, sem corrigir
 * nada e sem inventar versao quando um arquivo nao declara a sua.
 */

const PADROES = {
  cliente: {
    mediapipe: /VERSAO_MEDIAPIPE\s*=\s*["']([^"']+)["']/,
    transformers: /VERSAO_TRANSFORMERS\s*=\s*["']([^"']+)["']/,
    onnxruntime: /VERSAO_ONNXRUNTIME\s*=\s*["']([^"']+)["']/,
  },
  manifesto: {
    mediapipe: /\bmediapipe:\s*["']([^"']+)["']/,
    transformers: /\btransformers:\s*["']([^"']+)["']/,
    onnxruntime: /\bonnxruntime:\s*["']([^"']+)["']/,
  },
  mediapipe: /@mediapipe\/tasks-vision@(\d+\.\d+\.\d+)/,
  transformers: /@huggingface\/transformers@(\d+\.\d+\.\d+)/,
  onnxruntime: /onnxruntime-web@(\d+\.\d+\.\d+)/,
};

function extrair(texto, padrao) {
  const encontrado = padrao.exec(String(texto ?? ""));
  return encontrado ? encontrado[1] : null;
}

function versaoSemIntervalo(valor) {
  return typeof valor === "string" ? valor.replace(/^[\^~]/, "") : null;
}

/**
 * @param {object} textos Conteudo dos arquivos (o CLI le do disco; testes injetam).
 * @returns {{ok: boolean, versoes: object, problemas: string[]}}
 */
export function verificarCompatibilidade(textos = {}) {
  const problemas = [];
  const versoes = {
    mediapipe: extrair(textos.clienteOffline, PADROES.cliente.mediapipe),
    transformers: extrair(textos.clienteOffline, PADROES.cliente.transformers),
    onnxruntime: extrair(textos.clienteOffline, PADROES.cliente.onnxruntime),
  };

  for (const [nome, valor] of Object.entries(versoes)) {
    if (!valor) problemas.push(`public/offline.ts nao declara a versao de ${nome}.`);
  }

  const conferir = (rotulo, valor, esperado) => {
    if (!esperado) return;
    if (!valor) problemas.push(`${rotulo}: versao nao declarada (esperada ${esperado}).`);
    else if (valor !== esperado) {
      problemas.push(`${rotulo}: ${valor} difere de ${esperado} (public/offline.ts).`);
    }
  };

  conferir("scripts/offline-manifest.mjs", extrair(textos.manifestoOffline, PADROES.manifesto.mediapipe), versoes.mediapipe);
  conferir("scripts/offline-manifest.mjs", extrair(textos.manifestoOffline, PADROES.manifesto.transformers), versoes.transformers);
  conferir("scripts/offline-manifest.mjs", extrair(textos.manifestoOffline, PADROES.manifesto.onnxruntime), versoes.onnxruntime);
  conferir("public/gestos.ts", extrair(textos.gestos, PADROES.mediapipe), versoes.mediapipe);
  conferir("src/mediapipe-cdn.d.ts", extrair(textos.declaracoesMediapipe, PADROES.mediapipe), versoes.mediapipe);
  conferir("public/pose.ts", extrair(textos.pose, PADROES.transformers), versoes.transformers);
  conferir("src/transformers-cdn.d.ts", extrair(textos.declaracoesTransformers, PADROES.transformers), versoes.transformers);
  conferir("vitest.config.ts", extrair(textos.vitestConfig, PADROES.transformers), versoes.transformers);

  let pacote = null;
  try {
    pacote = JSON.parse(String(textos.packageJson ?? ""));
  } catch {
    problemas.push("package.json nao e JSON valido.");
  }
  if (pacote) {
    const runtime = versaoSemIntervalo(pacote.devDependencies?.["onnxruntime-web"]);
    conferir("package.json (onnxruntime-web)", runtime, versoes.onnxruntime);
    const engines = pacote.engines?.node;
    if (!engines) problemas.push("package.json nao declara engines.node.");
    const nvmrc = String(textos.nvmrc ?? "").trim();
    const nodeVersion = String(textos.nodeVersion ?? "").trim();
    if (!nvmrc || !nodeVersion) {
      problemas.push(".nvmrc e .node-version precisam estar presentes e nao vazios.");
    } else if (nvmrc !== nodeVersion) {
      problemas.push(`.nvmrc (${nvmrc}) difere de .node-version (${nodeVersion}).`);
    } else if (engines) {
      const major = /^(\d+)\./.exec(nvmrc)?.[1];
      if (!major) problemas.push(`.nvmrc contem versao invalida: ${nvmrc}.`);
      else if (!String(engines).includes(`${major}.`)) {
        problemas.push(`.nvmrc (${nvmrc}) nao esta coberto por engines.node (${engines}).`);
      }
    }
  }

  return { ok: problemas.length === 0, versoes, problemas };
}

export const ARQUIVOS = {
  clienteOffline: "public/offline.ts",
  manifestoOffline: "scripts/offline-manifest.mjs",
  gestos: "public/gestos.ts",
  pose: "public/pose.ts",
  declaracoesMediapipe: "src/mediapipe-cdn.d.ts",
  declaracoesTransformers: "src/transformers-cdn.d.ts",
  vitestConfig: "vitest.config.ts",
  packageJson: "package.json",
  nvmrc: ".nvmrc",
  nodeVersion: ".node-version",
};
