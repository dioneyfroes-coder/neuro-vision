import { readFile } from "node:fs/promises";
import path from "node:path";
import { carregarAnotacao } from "./anotacao.mjs";
import { TIPOS_IGNORADOS_PADRAO, ROOT, lerArgs } from "./constantes.mjs";
import { compararEventos } from "./comparacao.mjs";
import { lerInicioSidecarEventos, parsearEventos, resolverBaseMs } from "./eventos.mjs";
import { formatarRelatorio } from "./relatorio.mjs";

export async function main() {
  const args = lerArgs();
  if (!args.anotacao) {
    console.error(
      "Uso: npm run qualidade -- --anotacao bench/videos/<clipe>.json [--eventos logs/eventos.jsonl|logs/eventos-temporais.jsonl] [--tolerancia 3000] [--offset 0] [--ignorados resumo] [--json]"
    );
    process.exit(1);
  }

  const caminhoAnotacao = path.resolve(ROOT, args.anotacao);
  const anotacao = carregarAnotacao(JSON.parse(await readFile(caminhoAnotacao, "utf8")));

  const caminhoEventos = path.resolve(ROOT, args.eventos);
  const texto = await readFile(caminhoEventos, "utf8").catch(() => null);
  if (texto === null) {
    console.error(
      `Nao encontrei ${args.eventos}. Rode o app sobre o clipe e colete os eventos (logs/eventos.jsonl) antes de avaliar.`
    );
    process.exit(1);
  }

  const brutos = parsearEventos(texto);
  // Sidecars antigos substituiam `.jsonl` por `.inicio`; ambos os formatos sao aceitos.
  const inicioSidecar = await lerInicioSidecarEventos(caminhoEventos);
  const baseMs = resolverBaseMs({
    inicio: anotacao.inicio,
    inicioSidecar,
    timestamps: brutos.map((e) => e.timestamp),
  });
  const detectados = brutos
    .map((e) => ({ ...e, em: Date.parse(e.timestamp) - baseMs + args.offset }))
    .filter((e) => Number.isFinite(e.em));

  const escopoClasse =
    anotacao.negativos.includes("movimento_objeto.objeto_deslocado") ||
    anotacao.eventos.some(
      (evento) =>
        evento.categoria === "movimento_objeto" &&
        evento.classe === "objeto_deslocado"
    )
      ? "movimento_objeto.objeto_deslocado"
      : undefined;
  const rel = compararEventos({
    esperados: anotacao.eventos,
    detectados,
    escopoClasse,
    toleranciaMs: args.tolerancia,
    ignorados: args.ignorados ?? TIPOS_IGNORADOS_PADRAO,
    duracaoMs: anotacao.duracaoMs,
  });

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          clip: anotacao.clip,
          eventos: args.eventos,
          toleranciaMs: args.tolerancia,
          offsetMs: args.offset,
          ignorados: args.ignorados ?? TIPOS_IGNORADOS_PADRAO,
          ...rel,
        },
        null,
        2
      )
    );
    return;
  }

  console.log(formatarRelatorio(rel, { clip: anotacao.clip, toleranciaMs: args.tolerancia }));
}
