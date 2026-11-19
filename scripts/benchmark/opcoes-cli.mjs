export function lerArgs() {
  // 1024 da espaco para modelos de raciocinio ("thinking") escreverem a resposta:
  // com teto pequeno o `content` saiu vazio e o modelo pareceu nao responder.
  const mapa = { model: [], image: [], iter: 3, timeout: 300000 };
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
    else if (a === "--num-predict")
      throw new Error("--num-predict foi removido; o limite de saida fica a cargo do backend/modelo.");
    else if (a === "--timeout") mapa.timeout = Math.max(1000, Number(proximo()) || 120000);
    else if (a === "--json") mapa.json = true;
  }
  return mapa;
}