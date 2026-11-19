#!/usr/bin/env node

/**
 * Harness de benchmark por variante (Etapa 9).
 *
 * Compara as quatro variantes arquiteturais sobre o MESMO conjunto de clipes e,
 * quando informado, registrando a MESMA versao do modelo multimodal:
 *
 *   A (baseline)     frame unico (`deteccao`/`eventos`)     — referencia atual
 *   B (sequencia)    4 imagens, sem dados locais            — temporal "ausente"
 *   C (fundida)      4 imagens + dados locais               — temporal "basico"
 *   D (completa)     4 imagens + dados locais               — temporal "ampliado"
 *
 * Para cada variante o harness:
 *   1. le `logs/ciclos.jsonl` (registros `RegistroCiclo`, ver `src/domain/cycle.ts`)
 *      e agrega metricas por etapa (mediana e P95 de capturaMs, deteccaoMs,
 *      poseMs, maosMs, temporalMs, multimodalMs, persistenciaMs e totalMs,
 *      alem de observacoes, eventosTemporais, erros por etapa e cancelamentos);
 *   2. VERIFICA a versao do modelo multimodal usada por cada variante em
 *      `logs/visao.jsonl` (campo `modelo` das entradas, ligadas aos ciclos pelo
 *      frameId). O campo `modelo` de `eventos.jsonl` e o detector local, NAO o
 *      multimodal, e por isso nao entra nessa verificacao — o `--modelo-visao`
 *      apenas REGISTRA a intencao, a verificacao prova;
 *   3. roda a QUALIDADE por clipe, invocando o mesmo script de
 *      `npm run qualidade` (`scripts/avaliar-qualidade.mjs`) com `--json`,
 *      obtendo precisao, recall, F1, FP/min, eventos nao detectados e a
 *      distancia media de casamento (proxy de consistencia temporal);
 *   4. grava `bench/RELATORIO_VARIANTE_<A|B|C|D>_YYYYMMDD.md`;
 *   5. grava o consolidado `bench/COMPARATIVO_A_B_C_D_YYYYMMDD.md` APENAS se
 *      houver dados comparaveis. Sem ciclos concluidos suficientes, sem modelo
 *      multimodal verificado ou com o mesmo arquivo de eventos aplicado a mais
 *      de uma variante, o script nao grava o comparativo e termina com codigo
 *      nao zero (use `--permitir-inconclusivo` para gravar um diagnostico
 *      marcado como INCONCLUSIVO).
 *
 * Fase 5 (benchmark reproduzivel e decisao por dados):
 *   - `--warmups <n>` separa WARM-UP de execucao aquecida: os `n` primeiros
 *     ciclos CONCLUIDOS de cada variante sao tratados como aquecimento
 *     (compilacao/carga de modelo) e ficam FORA das medianas/P95; o cold start
 *     e reportado a parte, em ensaio proprio. Sem a flag (padrao 0) nada e
 *     excluido, preservando o comportamento anterior.
 *   - `--etapas-isoladas` acrescenta a secao "Etapas isoladas x ciclo
 *     completo": cada etapa local (captura/deteccao/pose/maos/temporal) medida
 *     por si so e depois somada no ciclo, a partir das MESMAS metricas reais de
 *     `logs/ciclos.jsonl` (nao inventa numeros). Exige amostras por etapa.
 *   - `--conjunto <nome>` registra QUAL conjunto reservado foi usado
 *     (ex.: `eval`) e entra no relatorio para provar que todas as variantes
 *     rodaram sobre o mesmo conjunto reservado.
 *   - `--min-f1`, `--max-fp-min`, `--ganho-minimo-f1`, `--custo-maximo-latencia`
 *     codificam o gate de qualidade x latencia: C/D so ficam "promoviveis a
 *     padrao" se baterem os criterios de qualidade E o ganho compensar o custo
 *     de latencia; caso contrario o veredito e "manter experimental".
 *
 * NUNCA sobrescreve `bench/BASELINE.md`: a gravacao passa por
 * `gravarRelatorioSeguro`, que recusa qualquer caminho fora do padrao
 * RELATORIO_VARIANTE_<letra>_* / COMPARATIVO_* e recusa explicitamente o
 * BASELINE.md.
 *
 * Compativel com PowerShell (Windows): todo processo filho e chamado via
 * `spawn(process.execPath, [...])` com array de argumentos — sem `&&`, sem
 * pipes, sem `head`/`tail`/`grep`, sem shell do sistema.
 *
 * Exemplos (PowerShell):
 *   node scripts/benchmark-variantes.mjs --clipes-dir bench/videos
 *   node scripts/benchmark-variantes.mjs --clipes bench/videos/webcam-mudanca.webm --variantes B,C,D
 *   node scripts/benchmark-variantes.mjs --eventos-B logs/webcam-eventos.jsonl --ciclos-D logs/ciclos.jsonl --modelo-visao qwen2.5-vl-3b-instruct
 *   node scripts/benchmark-variantes.mjs --sem-qualidade --json
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "./benchmark/execucao.mjs";

export { VARIANTES_BENCHMARK } from "./benchmark/constantes.mjs";
export { lerArgs } from "./benchmark/args.mjs";
export { intervaloConfiancaMediana } from "./benchmark/estatistica.mjs";
export { resolverSidecarInicioEventos, resumoDoClipe, descobrirClipes, lerCiclos, identificarVarianteDoRegistro, filtrarCiclosDaVariante, resolverArquivoEventos, resolverArquivoCiclos, extrairModelosDoJsonl, modelosDosFrames } from "./benchmark/artefatos.mjs";
export { ehCicloConcluido, agregarMetricasCiclos, separarWarmupCiclos, agregarEtapasIsoladas, avaliarGateQualidade } from "./benchmark/metricas.mjs";
export { verificarMesmoModelo, avaliarComparabilidade, executarQualidade } from "./benchmark/comparabilidade.mjs";
export { gravarRelatorioSeguro } from "./benchmark/relatorio.mjs";

export const caminhoDoModulo = fileURLToPath(import.meta.url);

export const executadoDiretamente =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === caminhoDoModulo;

if (executadoDiretamente) {
  main().catch((err) => {
    console.error(`ERRO: ${err.message}`);
    process.exit(1);
  });
}
