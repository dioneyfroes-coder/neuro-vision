/**
 * Formatação determinística da folha de revisão humana do E2E NSFW com clipe real.
 *
 * O módulo é puro: não lê vídeo, não chama modelo e não calcula acerto. Ele
 * transforma marcações já coletadas em uma tabela com colunas em branco para
 * conferência visual. `make_love` aparece como indício temporal, nunca como
 * confirmação do ato.
 */

/** Caixa normalizada em [0, 1], conforme `MarcacaoNsfwLog`. */
export interface CaixaNormalizada {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}

export interface MarcacaoParaRevisao {
  rotulo: string;
  score: number;
  caixa: CaixaNormalizada;
  modelo?: string;
  modelos?: readonly string[];
}

export interface AmostraParaRevisao {
  /** Offset aproximado desde o início da reprodução, em milissegundos. */
  offsetMs: number;
  capturadoEm: string;
  frameId?: string;
  modelo?: string;
  descricao?: string;
  latenciaMs?: number;
  marcacoes: readonly MarcacaoParaRevisao[];
}

export interface MetadadosRevisaoNsfwVideo {
  clip: string;
  sha256: string;
  bytes: number;
  largura: number;
  altura: number;
  duracaoVideoMs: number;
  duracaoMs: number;
  duracaoReproduzidaMs: number;
  inicio: string;
  limiar: number;
  modelosSolicitados: readonly string[];
  modelosObservados: readonly string[];
  modeloEfetivo?: string;
  respostasConcluidas: number;
  errosBackend: readonly string[];
  artefatos: readonly string[];
}

function celula(valor: unknown): string {
  if (valor === undefined || valor === null || valor === "") return "N/A";
  return String(valor).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function numero(valor: number | undefined, casas = 3): string {
  return Number.isFinite(valor) ? (valor as number).toFixed(casas) : "N/A";
}

function caixaNormalizada(caixa: CaixaNormalizada): string {
  return `[${numero(caixa.xmin)}, ${numero(caixa.ymin)}, ${numero(caixa.xmax)}, ${numero(caixa.ymax)}]`;
}

function caixaEmPixels(caixa: CaixaNormalizada, largura: number, altura: number): string {
  if (!Number.isFinite(largura) || !Number.isFinite(altura) || largura <= 0 || altura <= 0) {
    return "N/A";
  }
  return `[${Math.round(caixa.xmin * largura)}, ${Math.round(caixa.ymin * altura)}, ` +
    `${Math.round(caixa.xmax * largura)}, ${Math.round(caixa.ymax * altura)}]`;
}

function tabela(cabecalhos: readonly string[], linhas: ReadonlyArray<readonly string[]>): string[] {
  return [
    `| ${cabecalhos.join(" | ")} |`,
    `| ${cabecalhos.map(() => "---").join(" | ")} |`,
    ...linhas.map((linha) => `| ${linha.join(" | ")} |`),
  ];
}

export function formatarRelatorioRevisaoNsfwVideo(
  meta: MetadadosRevisaoNsfwVideo,
  amostras: readonly AmostraParaRevisao[]
): string {
  const saida: string[] = [];
  const totalMarcacoes = amostras.reduce((soma, amostra) => soma + amostra.marcacoes.length, 0);
  const rotulos = [...new Set(amostras.flatMap((amostra) => amostra.marcacoes.map((m) => m.rotulo)))].sort();

  saida.push("# Revisão humana — E2E NSFW com clipe real");
  saida.push("");
  saida.push(
    "> Marcações produzidas pelos modelos locais durante uma execução E2E real. " +
      "Não existe ground truth anotado: as colunas de acerto ficam vazias para conferência humana. " +
      "`make_love` é indício temporal, nunca confirmação do ato."
  );
  saida.push("");
  saida.push("## Execução");
  saida.push("");
  saida.push(
    ...tabela(
      ["Campo", "Valor"],
      [
        ["Clipe", celula(meta.clip)],
        ["SHA-256", celula(meta.sha256)],
        ["Bytes", celula(meta.bytes)],
        [`Quadro (${celula(meta.largura)}×${celula(meta.altura)})`, "caixas em pixels derivadas da caixa normalizada"],
        ["Duração do vídeo", `${numero(meta.duracaoVideoMs / 1000, 1)} s`],
        ["Janela reproduzida", `${numero(meta.duracaoMs / 1000, 1)} s`],
        ["Duração efetivamente reproduzida", `${numero(meta.duracaoReproduzidaMs / 1000, 1)} s`],
        ["Início (base dos offsets)", celula(meta.inicio)],
        ["Limiar global da interface", celula(meta.limiar)],
        ["Amostras com campo NSFW", celula(amostras.length)],
        ["Marcações coletadas", celula(totalMarcacoes)],
        ["Rótulos observados", celula(rotulos.join(", ") || "nenhum")],
      ]
    )
  );
  saida.push("");
  saida.push("## Pesos e backend");
  saida.push("");
  saida.push(
    ...tabela(
      ["Item", "Resultado observado"],
      [
        ["Modelos solicitados pelo conjunto", celula(meta.modelosSolicitados.join(", "))],
        ["Pesos requisitados no E2E", celula(meta.modelosObservados.join(", ") || "nenhum")],
        ["Modelo efetivo nas respostas `done`", celula(meta.modeloEfetivo)],
        ["Respostas concluídas", celula(meta.respostasConcluidas)],
        ["Erros do backend", celula(meta.errosBackend.join(" ; ") || "nenhum")],
      ]
    )
  );
  saida.push("");
  if (meta.respostasConcluidas === 0) {
    saida.push(
      "Sem resposta `done`, a descrição multimodal fica `N/A`: isso não invalida " +
        "as marcações do classificador local, que são enviadas antes da chamada ao backend."
    );
    saida.push("");
  }
  saida.push("## Amostras");
  saida.push("");
  saida.push(
    ...tabela(
      ["Offset (ms)", "Capturado em", "Frame", "Marcações", "Rótulos", "Descrição", "Latência (ms)", "Modelo efetivo"],
      amostras.map((amostra) => [
        celula(amostra.offsetMs),
        celula(amostra.capturadoEm),
        celula(amostra.frameId),
        celula(amostra.marcacoes.length),
        celula(amostra.marcacoes.map((m) => m.rotulo).join(", ") || "nenhuma"),
        celula(amostra.descricao),
        celula(amostra.latenciaMs),
        celula(amostra.modelo),
      ])
    )
  );
  saida.push("");
  saida.push("## Detalhes para conferência");
  saida.push("");
  saida.push(
    ...tabela(
      ["Offset (ms)", "Rótulo", "Score", "Caixa normalizada", "Caixa em pixels", "Modelos", "Acerto?", "Observação", "Revisor", "Data"],
      amostras.flatMap((amostra) =>
        amostra.marcacoes.map((marcacao) => [
          celula(amostra.offsetMs),
          celula(marcacao.rotulo),
          numero(marcacao.score),
          celula(caixaNormalizada(marcacao.caixa)),
          celula(caixaEmPixels(marcacao.caixa, meta.largura, meta.altura)),
          celula(marcacao.modelos?.join(", ") || marcacao.modelo),
          "",
          "",
          "",
          "",
        ])
      )
    )
  );
  saida.push("");
  saida.push("## Como conferir");
  saida.push("");
  saida.push("1. Abra o clipe no offset da linha e compare a caixa em pixels com o quadro.");
  saida.push("2. Preencha `Acerto?` com `sim`, `nao` ou `parcial`; registre a observação e o revisor.");
  saida.push("3. Para `make_love`, julgue apenas se há indício temporal compatível — nunca o ato em si.");
  saida.push("4. Esta folha não produz precisão, recall ou F1: não há anotação revisada nem denominador.");
  saida.push("");
  saida.push("## Artefatos brutos");
  saida.push("");
  for (const artefato of meta.artefatos) saida.push(`- \`${celula(artefato)}\``);
  saida.push("");
  return saida.join("\n");
}
