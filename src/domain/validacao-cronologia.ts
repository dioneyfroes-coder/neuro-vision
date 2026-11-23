/**
 * Validação de cronologia, evidências e incerteza (Fase 4, plano §9).
 *
 * O schema canônico verifica apenas se `inicioEm`/`fimEm` são datas parseáveis.
 * Aqui a checagem é semântica e determinística: ordem dos intervalos, janela do
 * ciclo e coerência entre frame citado como evidência e seu carimbo real.
 * Módulo puro: sem relógio, sem IO e sem acesso a modelo.
 */

export interface FrameParaCronologia {
  frameId: string;
  capturadoEm?: string;
  capturadoEmMs?: number;
  offsetMs?: number;
}

export interface ContextoCronologia {
  /** Início da janela do ciclo, em ISO. */
  iniciadoEm?: string;
  /** Duração da janela, em ms. */
  janelaMs?: number;
  frames?: ReadonlyArray<FrameParaCronologia>;
}

export interface DiagnosticoAcaoCronologia {
  /** Índice 0-based da ação na resposta. */
  indice: number;
  descricao?: string;
  erros: string[];
  avisos: string[];
  incertezas: string[];
}

export interface DiagnosticoCronologia {
  status: "valido" | "inconsistente" | "sem_dados";
  erros: string[];
  avisos: string[];
  incertezas: string[];
  acoes: DiagnosticoAcaoCronologia[];
}

const MS_POR_SEGUNDO = 1_000;

function msDe(valor: string | number | undefined): number | undefined {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : undefined;
  if (typeof valor !== "string") return undefined;
  const ms = Date.parse(valor);
  return Number.isFinite(ms) ? ms : undefined;
}

function texto(valor: unknown): string | undefined {
  return typeof valor === "string" && valor.trim() !== "" ? valor : undefined;
}

/** Valida ações `{ inicioEm, fimEm, evidencias }` contra a janela e os frames. */
export function validarCronologiaResposta(
  valor: unknown,
  contexto: ContextoCronologia = {}
): DiagnosticoCronologia {
  const diagnostico: DiagnosticoCronologia = {
    status: "sem_dados",
    erros: [],
    avisos: [],
    incertezas: [],
    acoes: [],
  };
  if (valor === null || typeof valor !== "object" || Array.isArray(valor)) return diagnostico;
  const acoes = (valor as Record<string, unknown>).acoes;
  if (!Array.isArray(acoes) || acoes.length === 0) {
    diagnostico.avisos.push("nenhuma acao com intervalo temporal para validar");
    return diagnostico;
  }

  const inicioJanela = msDe(contexto.iniciadoEm);
  const janelaMs = Number.isFinite(contexto.janelaMs) ? (contexto.janelaMs as number) : undefined;
  const fimJanela =
    inicioJanela !== undefined && janelaMs !== undefined && janelaMs >= 0
      ? inicioJanela + janelaMs
      : undefined;
  const frames = new Map(
    (contexto.frames ?? []).map((f) => [
      f.frameId,
      msDe(f.capturadoEmMs ?? f.capturadoEm ?? f.offsetMs),
    ])
  );

  acoes.forEach((acao, indice) => {
    if (acao === null || typeof acao !== "object" || Array.isArray(acao)) return;
    const obj = acao as Record<string, unknown>;
    const item: DiagnosticoAcaoCronologia = {
      indice,
      descricao: texto(obj.descricao),
      erros: [],
      avisos: [],
      incertezas: [],
    };
    const inicio = msDe(obj.inicioEm as string | undefined);
    const fim = msDe(obj.fimEm as string | undefined);

    if (inicio === undefined || fim === undefined) {
      item.erros.push("intervalo incompleto ou invalido");
      item.incertezas.push("nao e possivel situar a acao no tempo");
    } else {
      if (inicio > fim) {
        item.erros.push("inicioEm posterior a fimEm");
      }
      if (inicioJanela !== undefined && inicio < inicioJanela) {
        item.erros.push("inicioEm anterior ao inicio da janela do ciclo");
      }
      if (fimJanela !== undefined && fim > fimJanela) {
        item.erros.push("fimEm posterior ao fim da janela do ciclo");
      }
      const duracaoMs = fim - inicio;
      if (duracaoMs > 0 && duracaoMs < MS_POR_SEGUNDO) {
        item.avisos.push("intervalo menor que 1s: resolucao insuficiente para duracao de acao");
      }
    }

    const evidencias = Array.isArray(obj.evidencias)
      ? obj.evidencias.filter((e): e is string => typeof e === "string" && e.trim() !== "")
      : [];
    if (evidencias.length === 0) {
      item.avisos.push("acao sem frame de evidencia");
      item.incertezas.push("sem suporte visual citado");
    }
    for (const id of evidencias) {
      if (!frames.has(id)) {
        item.erros.push(`evidencia ${id} nao existe no ciclo`);
        continue;
      }
      const tempo = frames.get(id);
      if (inicio === undefined || fim === undefined || tempo === undefined) {
        item.incertezas.push(`tempo da evidencia ${id} indisponivel`);
        continue;
      }
      if (tempo < inicio || tempo > fim) {
        item.avisos.push(`evidencia ${id} fora do intervalo da acao`);
        item.incertezas.push(`evidencia ${id} pode nao sustentar o intervalo declarado`);
      }
    }

    diagnostico.acoes.push(item);
    diagnostico.erros.push(...item.erros.map((e) => `acao[${indice}]: ${e}`));
    diagnostico.avisos.push(...item.avisos.map((a) => `acao[${indice}]: ${a}`));
    diagnostico.incertezas.push(...item.incertezas.map((i) => `acao[${indice}]: ${i}`));
  });

  diagnostico.status = diagnostico.acoes.length === 0 ? "sem_dados" : diagnostico.erros.length > 0 ? "inconsistente" : "valido";
  return diagnostico;
}
