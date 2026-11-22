/**
 * Exigência de evidências e separação observação/inferência (Fase 6, itens 5 e 6).
 *
 * Regras puras aplicadas **depois** da validação de referências: uma afirmação
 * do modelo sem ao menos uma referência válida não entra na lista de fatos —
 * vai para `afirmacoesSemEvidencia`, com o texto original preservado. O status
 * de evidência é derivado somente da percepção local; `natureza` do modelo
 * nunca o altera.
 */
import {
  statusEvidenciaEvento,
  type StatusEvidencia,
} from "./evidencia";
import type { EstadoEventoTemporal, MotivoEncerramentoEvento } from "./temporal-event";
import type { AcaoInterpretada, ParticipanteInterpretado, ResultadoInterpretacao } from "./interpretation";

/** Subsete estrutural do contexto serializado — o domínio não depende da UI. */
export interface ContextoParaEvidencia {
  frames: readonly {
    frameId: string;
    /** `false` quando subsistemas necessários falharam neste frame. */
    percepcaoValida?: boolean;
  }[];
  eventosTemporais: readonly {
    eventoId: string;
    tipo?: string;
    /** `status` é o nome do campo no contexto versionado (contexto-1). */
    status?: string;
    evidencias?: readonly string[];
    motivoEncerramento?: MotivoEncerramentoEvento;
    gapMs?: number;
  }[];
}

export interface AfirmacaoSemEvidencia {
  tipo: "resumo" | "acao" | "participante";
  texto: string;
}

export interface DistincaoEvidenciaInterpretacao {
  /** ID de frame/evento local com o status derivado da percepção. */
  observacoesLocais: Array<{ id: string; statusEvidencia: StatusEvidencia }>;
  /** Leitura do modelo, com a natureza declarada por ele (nunca um fato). */
  inferenciasModelo: Array<{ descricao: string; natureza?: string }>;
  /** Texto do modelo que não pôde ser verificado ou que ele marcou como incerto. */
  naoVerificado: string[];
  /** Derivado somente dos eventos locais — nunca da resposta do modelo. */
  statusEvidenciaLocal: StatusEvidencia;
  resumoSemEvidencia: boolean;
}

export interface InterpretacaoComEvidencia {
  resultado: ResultadoInterpretacao;
  afirmacoesSemEvidencia: AfirmacaoSemEvidencia[];
  distincao: DistincaoEvidenciaInterpretacao;
}

const PRIORIDADE: StatusEvidencia[] = [
  "falha_percepcao",
  "ocluido",
  "desconhecido",
  "inferido",
  "observado",
  "possivel",
  "nao_observado",
];

function statusDoEventoLocal(
  evento: ContextoParaEvidencia["eventosTemporais"][number]
): StatusEvidencia {
  return statusEvidenciaEvento({
    estado: (evento.status ?? "candidato") as EstadoEventoTemporal,
    tipo: evento.tipo,
    motivoEncerramento: evento.motivoEncerramento,
    frameIds: [...(evento.evidencias ?? [])],
    intervaloSemObservacaoMs: evento.gapMs,
  });
}

/** Agrega o status local sem transformar falha/oclusão em ausência. */
export function statusEvidenciaLocal(contexto: ContextoParaEvidencia): StatusEvidencia {
  const status: StatusEvidencia[] = [
    ...contexto.frames.map((frame) =>
      frame.percepcaoValida === false ? "falha_percepcao" : "observado"
    ),
    ...contexto.eventosTemporais.map(statusDoEventoLocal),
  ];
  for (const candidato of PRIORIDADE) {
    if (status.includes(candidato)) return candidato;
  }
  return "desconhecido";
}

/**
 * Aplica a exigência de evidência e produz a separação observação/inferência.
 * Não fabrica referências: o que não tem suporte é removido dos fatos e
 * devolvido em `afirmacoesSemEvidencia`.
 */
export function aplicarExigenciaEvidencias(
  resultado: ResultadoInterpretacao,
  contexto: ContextoParaEvidencia
): InterpretacaoComEvidencia {
  const afirmacoesSemEvidencia: AfirmacaoSemEvidencia[] = [];
  const acoes: AcaoInterpretada[] = [];
  for (const acao of resultado.acoes) {
    if (acao.evidencias.length === 0) {
      afirmacoesSemEvidencia.push({ tipo: "acao", texto: acao.descricao });
      continue;
    }
    acoes.push(acao);
  }
  const participantes: ParticipanteInterpretado[] = [];
  for (const participante of resultado.participantes ?? []) {
    if (participante.evidencias.length === 0) {
      afirmacoesSemEvidencia.push({ tipo: "participante", texto: participante.descricao });
      continue;
    }
    participantes.push(participante);
  }
  const resumoSemEvidencia = resultado.evidencias.length === 0;
  if (resumoSemEvidencia && resultado.resumo.trim()) {
    afirmacoesSemEvidencia.push({ tipo: "resumo", texto: resultado.resumo });
  }

  const naoVerificado = [
    ...afirmacoesSemEvidencia.map((a) => a.texto),
    ...resultado.incertezas,
  ];
  const distincao: DistincaoEvidenciaInterpretacao = {
    observacoesLocais: [
      ...contexto.frames.map((frame) => ({
        id: frame.frameId,
        statusEvidencia: (frame.percepcaoValida === false
          ? "falha_percepcao"
          : "observado") as StatusEvidencia,
      })),
      ...contexto.eventosTemporais.map((evento) => ({
        id: evento.eventoId,
        statusEvidencia: statusDoEventoLocal(evento),
      })),
    ],
    inferenciasModelo: acoes.map((acao) => ({
      descricao: acao.descricao,
      natureza: acao.natureza,
    })),
    naoVerificado: [...new Set(naoVerificado)],
    statusEvidenciaLocal: statusEvidenciaLocal(contexto),
    resumoSemEvidencia,
  };

  return {
    resultado: {
      ...resultado,
      // O resumo sem evidência fica apenas em `afirmacoesSemEvidencia` e no
      // texto bruto; nunca permanece como narrativa verificada.
      resumo: resumoSemEvidencia ? "" : resultado.resumo,
      acoes,
      ...(resultado.participantes !== undefined ? { participantes } : {}),
      afirmacoesSemEvidencia,
      distincaoEvidencia: distincao,
    },
    afirmacoesSemEvidencia,
    distincao,
  };
}
