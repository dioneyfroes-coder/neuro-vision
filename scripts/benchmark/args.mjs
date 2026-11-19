import { LETRAS } from "./constantes.mjs";
import { clamp01 } from "./estatistica.mjs";

export function lerArgs(lista = process.argv.slice(2)) {
  const mapa = {
    clipesDir: "bench/videos",
    anotacoesDir: null,
    clipes: [],
    variantes: LETRAS,
    ciclos: "logs/ciclos.jsonl",
    eventos: "logs/eventos.jsonl",
    visao: "logs/visao.jsonl",
    tolerancia: 3000,
    offset: 0,
    ignorados: "resumo",
    saida: "bench",
    minCiclos: 2,
    minAmostrasEstatisticas: 10,
    warmups: 0,
    etapasIsoladas: false,
    conjunto: null,
    criteriosQualidade: {
      minF1: 0.5,
      maxFpMin: 2,
      ganhoMinimoF1: 0.1,
      custoMaximoLatencia: 1.5,
    },
    ciclosPorVariante: {},
    eventosPorVariante: {},
    eventosPorClipeVariante: {},
    sessoesPorVariante: {},
    modeloPorVariante: {},
    semQualidade: false,
    semRelatorio: false,
    permitirInconclusivo: false,
    json: false,
  };
  for (let i = 0; i < lista.length; i++) {
    const a = lista[i];
    const proximo = () => lista[++i] ?? "";

    const eventosPorClipe = a.match(/^--eventos-([A-Da-d])-(.+)$/);
    if (eventosPorClipe) {
      const [, letra, clipe] = eventosPorClipe;
      const L = letra.toUpperCase();
      mapa.eventosPorClipeVariante[L] ??= {};
      mapa.eventosPorClipeVariante[L][clipe] = proximo();
      continue;
    }

    // Opcoes por variante: `--ciclos-B`, `--eventos-D`, `--sessao-C`, `--modelo-B`...
    const porVariante = a.match(/^--(ciclos|eventos|sessao|modelo)-([A-Da-d])$/);
    if (porVariante) {
      const [, chave, letra] = porVariante;
      const L = letra.toUpperCase();
      const valor = proximo();
      if (chave === "ciclos") mapa.ciclosPorVariante[L] = valor;
      else if (chave === "eventos") mapa.eventosPorVariante[L] = valor;
      else if (chave === "sessao") mapa.sessoesPorVariante[L] = valor;
      else mapa.modeloPorVariante[L] = valor;
      continue;
    }

    if (a === "--clipes-dir") mapa.clipesDir = proximo();
    else if (a === "--anotacoes-dir") mapa.anotacoesDir = proximo();
    else if (a === "--clipes") mapa.clipes.push(...proximo().split(",").map((s) => s.trim()).filter(Boolean));
    else if (a === "--variantes") {
      mapa.variantes = proximo()
        .split(/[\s,]+/)
        .map((s) => s.trim().toUpperCase())
        .filter((s) => LETRAS.includes(s));
      if (!mapa.variantes.length) mapa.variantes = LETRAS;
    } else if (a === "--ciclos") mapa.ciclos = proximo();
    else if (a === "--eventos") mapa.eventos = proximo();
    else if (a === "--visao") mapa.visao = proximo();
    else if (a === "--help" || a === "-h") mapa.help = true;
    else if (a === "--tolerancia") mapa.tolerancia = Math.max(0, Number(proximo()) || 0);
    else if (a === "--offset") mapa.offset = Number(proximo()) || 0;
    else if (a === "--ignorados") mapa.ignorados = proximo();
    else if (a === "--modelo" || a === "--modelo-visao") mapa.modeloVisao = proximo();
    else if (a === "--min-ciclos") mapa.minCiclos = Math.max(1, Number(proximo()) || 1);
    else if (a === "--min-amostras-estatisticas")
      mapa.minAmostrasEstatisticas = Math.max(1, Number(proximo()) || 1);
    else if (a === "--warmups") mapa.warmups = Math.max(0, Number(proximo()) || 0);
    else if (a === "--etapas-isoladas") mapa.etapasIsoladas = true;
    else if (a === "--conjunto") mapa.conjunto = proximo().trim() || null;
    else if (a === "--min-f1") mapa.criteriosQualidade.minF1 = clamp01(proximo());
    else if (a === "--max-fp-min") mapa.criteriosQualidade.maxFpMin = Math.max(0, Number(proximo()) || 0);
    else if (a === "--ganho-minimo-f1") mapa.criteriosQualidade.ganhoMinimoF1 = clamp01(proximo());
    else if (a === "--custo-maximo-latencia")
      mapa.criteriosQualidade.custoMaximoLatencia = Math.max(1, Number(proximo()) || 1);
    else if (a === "--data") mapa.data = proximo().replace(/[^0-9]/g, "");
    else if (a === "--saida") mapa.saida = proximo();
    else if (a === "--sem-qualidade") mapa.semQualidade = true;
    else if (a === "--sem-relatorio") mapa.semRelatorio = true;
    else if (a === "--permitir-inconclusivo") mapa.permitirInconclusivo = true;
    else if (a === "--json") mapa.json = true;
  }
  return mapa;
}
