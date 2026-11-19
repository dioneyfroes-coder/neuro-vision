import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const SCRIPT_QUALIDADE = path.join(ROOT, "scripts", "avaliar-qualidade.mjs");

/**
 * Matriz de variantes do benchmark (espelha `public/perception/variantes.ts` e
 * `public/modos.ts`; a variante A nao vive la porque e o fluxo de frame unico).
 */
export const VARIANTES_BENCHMARK = [
  {
    letra: "A",
    id: "baseline",
    rotulo: "A · Baseline (frame único)",
    modo: "deteccao|eventos",
    percepcaoLocal: false,
    imagens: 1,
    dadosLocais: false,
    temporal: "ausente",
    objetivo: "referência atual (um frame por análise)",
    // Trechos de sessionId que identificam os ciclos desta variante.
    sessoes: ["variante-a", "baseline", "frame-unico", "frameunico"],
  },
  {
    letra: "B",
    id: "sequencia",
    rotulo: "B · Sequência (4 imagens, sem dados locais)",
    modo: "percepcao-sequencia",
    percepcaoLocal: false,
    imagens: 4,
    dadosLocais: false,
    temporal: "ausente",
    objetivo: "custo/benefício de mandar só a sequência de imagens",
    sessoes: ["variante-b", "percepcao-sequencia", "sequencia"],
  },
  {
    letra: "C",
    id: "fundida",
    rotulo: "C · Percepção fundida (dados locais, temporal básico)",
    modo: "percepcao-fundida",
    percepcaoLocal: true,
    imagens: 4,
    dadosLocais: true,
    temporal: "basico",
    objetivo: "contexto local estruturado com leitura temporal básica",
    sessoes: ["variante-c", "percepcao-fundida", "fundida"],
  },
  {
    letra: "D",
    id: "completa",
    rotulo: "D · Arquitetura-alvo (dados locais, temporal ampliado)",
    modo: "percepcao",
    percepcaoLocal: true,
    imagens: 4,
    dadosLocais: true,
    temporal: "ampliado",
    objetivo: "arquitetura-alvo completa",
    // "percepcao" so casa D depois de B/C terem sido descartados (o id deles
    // tambem contem "percepcao").
    sessoes: ["variante-d", "completa", "percepcao"],
  },
];

export const LETRAS = VARIANTES_BENCHMARK.map((v) => v.letra);

/** Arquivo imutavel: nenhum caminho de saida pode apontar para ele. */
export const ARQUIVO_IMUTAVEL = "BASELINE.md";

export const USO = `
Uso: node scripts/benchmark-variantes.mjs [opcoes]

Compara as variantes A/B/C/D sobre o MESMO conjunto de clipes e registra a
versao do modelo multimodal usada por cada uma (verificada em logs/visao.jsonl
pelos frameIds dos ciclos). O campo "modelo" dos eventos e o detector local e nao
conta como modelo multimodal.

Opcoes:
  --clipes-dir <dir>       Diretorio dos clipes de video (padrao: bench/videos)
  --anotacoes-dir <dir>     Diretorio das anotacoes .json (padrao: ao lado dos videos; permite separar tuning/eval)
  --clipes <a,b,...>       Lista explicita de clipes (substitui --clipes-dir)
  --variantes <A,B,C,D>    Somente estas variantes (padrao: todas)
  --ciclos <arquivo>       JSONL de RegistroCiclo (padrao: logs/ciclos.jsonl)
  --ciclos-<X> <arquivo>   Arquivo de ciclos exclusivo da variante X
  --eventos <arquivo>      JSONL de eventos (padrao: logs/eventos.jsonl)
  --eventos-<X> <arquivo>  Arquivo de eventos exclusivo da variante X
  --eventos-<X>-<clipe> <arquivo>
                            Eventos exclusivos da variante e do nome completo do clipe
  --sessao-<X> <trecho>    Filtra ciclos da variante X por sessionId/cycleId
  --visao <arquivo>        JSONL de observacoes para verificar o modelo
                           (padrao: logs/visao.jsonl)
  --modelo <nome>          Versao do modelo multimodal usada em todas as
                           variantes (alias: --modelo-visao; tambem le
                           NEURO_MODELO_VISAO). Obrigatoria para concluir.
  --min-ciclos <n>         Minimo de ciclos CONCLUIDOS por variante (padrao: 2).
                           Um unico ciclo nunca e tratado como conclusivo.
  --min-amostras-estatisticas <n>
                           Ciclos concluidos por variante (regime aquecido) para
                           considerar a amostra estatisticamente suficiente e
                           reportar IC da mediana (padrao: 10). Abaixo disso a
                           rodada pode ser COMPARAVEL, mas nao CONCLUSIVA.
  --warmups <n>            Primeiros n ciclos concluidos de cada variante sao
                           WARM-UP: ficam fora das medianas/P95 (padrao: 0).
                           O cold start e reportado a parte.
  --etapas-isoladas        Acrescenta a secao "Etapas isoladas x ciclo
                           completo" (cada etapa local medida por si so).
  --conjunto <nome>        Registra o conjunto reservado usado (ex.: eval);
                           eval exige o conjunto validado por npm run validar:eval;
                           o nome entra no relatorio e no comparativo.
  --min-f1 <0..1>          Gate de qualidade: F1 minimo (padrao: 0.5).
  --max-fp-min <n>         Gate de qualidade: FP/min maximo (padrao: 2).
  --ganho-minimo-f1 <0..1> Ganho minimo de F1 de C/D sobre A/B para justificar
                           o custo de latencia (padrao: 0.1).
  --custo-maximo-latencia <x> Aumento maximo da mediana de totalMs de C/D sobre
                           A/B que ainda compensa o ganho de F1 (padrao: 1.5).
  --tolerancia <ms>        Tolerancia de casamento do qualidade (padrao: 3000)
  --offset <ms>            Offset de base do qualidade (padrao: 0)
  --ignorados <tipos>      Tipos ignorados no qualidade (padrao: resumo)
  --data <YYYYMMDD>        Data nos nomes dos relatorios (padrao: hoje)
  --saida <dir>            Diretorio dos relatorios (padrao: bench)
  --sem-qualidade          Pula a qualidade; a conclusao fica restrita ao
                           desempenho (sem comparar F1/FP/min)
  --sem-relatorio          Nao grava RELATORIO_*/COMPARATIVO_*
  --permitir-inconclusivo  Grava o COMPARATIVO mesmo sem dados comparaveis,
                           com veredito INCONCLUSIVO e os problemas listados
  --json                   Imprime o resultado consolidado em JSON
  --help, -h               Esta ajuda

Saida: bench/RELATORIO_VARIANTE_<X>_YYYYMMDD.md por variante e
bench/COMPARATIVO_A_B_C_D_YYYYMMDD.md. O bench/BASELINE.md NUNCA e alterado.

Exemplos (PowerShell):
  node scripts/benchmark-variantes.mjs --clipes-dir bench/videos --anotacoes-dir bench/clipes/eval
  node scripts/benchmark-variantes.mjs --clipes bench/videos/webcam-mudanca.webm --variantes B,C,D
  node scripts/benchmark-variantes.mjs --eventos-D logs/webcam-eventos.jsonl --modelo-visao qwen2.5-vl-3b-instruct
  node scripts/benchmark-variantes.mjs --conjunto eval --anotacoes-dir bench/clipes/eval --warmups 1 --etapas-isoladas
`.trim();

export const EXTENSOES_VIDEO = /\.(mp4|webm|mkv|avi|mov)$/i;

export const ETAPAS_MS = [
  "capturaMs",
  "deteccaoMs",
  "poseMs",
  "maosMs",
  "temporalMs",
  "multimodalMs",
  "persistenciaMs",
  "percepcaoTotalMs",
  "latenciaAteRespostaMultimodalMs",
  "latenciaEntreCiclosMs",
  "totalMs",
];

/** Subsistemas de percepcao usados nas metricas por ciclo (P3.1). */
export const SUBSISTEMAS_METRICA = ["deteccao", "pose", "maos", "nsfw"];

/** Adaptadores cujo dispositivo efetivo deve aparecer no relatorio. */
export const ADAPTADORES_ESPERADOS = ["deteccao", "pose", "maos"];

/**
 * Etapas LOCAIS (nao incluem o multimodal remoto nem o total do ciclo). Serve
 * para a secao "etapas isoladas": cada uma deve caber sozinha no orcamento
 * antes de somar o ciclo inteiro. A ordem e a ordem real do pipeline.
 */
export const ETAPAS_LOCAIS = ["capturaMs", "deteccaoMs", "poseMs", "maosMs", "temporalMs"];

// ---------------------------------------------------------------------------
// Gravacao segura (nunca sobrescrever bench/BASELINE.md)
// ---------------------------------------------------------------------------

export const PADRAO_RELATORIO = /^(RELATORIO_VARIANTE_[ABCD]_|COMPARATIVO_[ABCD](_[ABCD])*_)\d+\.md$/;
