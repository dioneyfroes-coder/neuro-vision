import { estaIndisponivel, naoFoiAmostrado } from "../../../src/domain";
import type {
  ObservacaoFrame,
  PacoteCiclo,
  ResultadoOuIndisponivel,
} from "../../../src/domain";
import {
  arredondar,
  calcularMovimento,
  estadoSubsistema,
  serializarDeteccoes,
  serializarMaos,
  serializarNsfw,
  serializarPessoas,
  OPCOES_SERIALIZACAO_PADRAO,
  VERSAO_ESQUEMA_CONTEXTO,
  type ContextoCicloSerializavel,
  type EventoTemporalSerializavel,
  type ObservacaoLocalSerializavel,
  type OpcoesSerializacao,
} from "../esquema";
import {
  priorizarDeteccoes,
  type ConfigProximidadeObjetos,
} from "../proximidade-objetos";
import { limitarPorBytes } from "./compactacao";
import {
  LIMITES_CONTEXTO_PADRAO,
  type FrameMontado,
  type LimitesContexto,
  type OpcoesContexto,
  type PayloadContexto,
} from "./tipos";

/**
 * Montagem do contexto estruturado de um ciclo (Etapa 7 do roteiro).
 *
 * Converte o `PacoteCiclo` num conjunto de registros JSON **versionados** (ver
 * `esquema.ts`): deteccoes com caixas normalizadas e score individual, pessoas
 * com keypoints nomeados e identidade de track, maos com lateralidade/gesto e
 * landmarks, movimento entre frames, estado por subsistema e eventos temporais
 * com status/evidencias/gap. Substitui os resumos textuais anteriores por
 * evidencia estruturada, respeitando tetos de tamanho e de dados numericos.
 *
 * Cada frame do contexto corresponde a **uma imagem**, na mesma ordem; o campo
 * `indice` (1-based) liga o texto enviado ao modelo a imagem correta.
 *
 * A **evidencia observada** (detectores) permanece em `frames`/`eventosTemporais`;
 * a **inferencia textual** do modelo vai separada em `inferencia` (ver
 * `InferenciaMultimodalSerializavel`), sem fundir os dois graus de certeza.
 */

/**
 * Monta o contexto estruturado e a lista de imagens do ciclo, na ordem
 * cronologica, respeitando os limites (tamanho e dados numericos).
 */
export function montarContextoCiclo(
  pacote: PacoteCiclo,
  limites: Partial<LimitesContexto> = {},
  opcoes: OpcoesContexto = {}
): PayloadContexto {
  const cfg: LimitesContexto = { ...LIMITES_CONTEXTO_PADRAO, ...limites };
  const serializacao: OpcoesSerializacao = {
    ...OPCOES_SERIALIZACAO_PADRAO,
    decimais: cfg.decimais,
    ...opcoes.serializacao,
  };
  const incluirDadosLocais = opcoes.incluirDadosLocais ?? true;
  const ordenadas = [...pacote.observacoes].sort((a, b) => a.capturadoEmMs - b.capturadoEmMs);
  const selecionadas = amostrar(ordenadas, cfg.maxImagens);
  const baseMs = selecionadas.length > 0 ? selecionadas[0].capturadoEmMs : 0;

  const frames: ObservacaoLocalSerializavel[] = [];
  // Posicoes do frame anterior (por `tipo:trackId`) para calcular movimento.
  let posicoesAnteriores = new Map<string, { x: number; y: number; tMs: number }>();

  selecionadas.forEach((obs, i) => {
    const montado = montarObservacao(obs, i + 1, Math.round(obs.capturadoEmMs - baseMs), {
      incluirDadosLocais,
      serializacao,
      posicoesAnteriores,
      proximidadeObjetos: opcoes.proximidadeObjetos,
    });
    posicoesAnteriores = montado.posicoes;
    frames.push(montado.observacao);
  });

  const eventosTemporais = incluirDadosLocais
    ? pacote.eventosTemporais
        .slice(0, cfg.maxEventos)
        .map((e) => serializarEvento(e, serializacao.decimais))
    : [];

  const indisponibilidades = incluirDadosLocais ? coletarIndisponibilidades(ordenadas) : [];

  const janelaMs =
    ordenadas.length > 1
      ? Math.round(ordenadas[ordenadas.length - 1].capturadoEmMs - ordenadas[0].capturadoEmMs)
      : 0;

  const contexto: ContextoCicloSerializavel = {
    versao: VERSAO_ESQUEMA_CONTEXTO,
    sessionId: pacote.sessionId,
    cycleId: pacote.cycleId,
    iniciadoEm: pacote.iniciadoEm,
    janelaMs,
    frames,
    eventosTemporais,
    resumoTemporal: {
      tracksAtivos: incluirDadosLocais ? pacote.resumoTemporal.tracksAtivos : 0,
      pessoasAtivas: incluirDadosLocais ? pacote.resumoTemporal.pessoasAtivas : 0,
      maosAtivas: incluirDadosLocais ? pacote.resumoTemporal.maosAtivas : 0,
      objetosAtivos: incluirDadosLocais ? pacote.resumoTemporal.objetosAtivos : 0,
      houveIntervaloSemObservacao: incluirDadosLocais
        ? Boolean(pacote.resumoTemporal.houveIntervaloSemObservacao)
        : false,
      intervaloSemObservacaoMs: incluirDadosLocais
        ? pacote.resumoTemporal.intervaloSemObservacaoMs
        : undefined,
    },
    indisponibilidades,
  };

  limitarPorBytes(contexto, cfg.maxBytesContexto);

  return { imagens: selecionadas.map((obs) => obs.imagem), contexto };
}

function montarObservacao(
  obs: ObservacaoFrame,
  indice: number,
  offsetMs: number,
  ctx: {
    incluirDadosLocais: boolean;
    serializacao: OpcoesSerializacao;
    posicoesAnteriores: Map<string, { x: number; y: number; tMs: number }>;
    proximidadeObjetos?: Partial<ConfigProximidadeObjetos>;
  }
): FrameMontado {
  const { incluirDadosLocais, serializacao } = ctx;
  const dimensoes = estaIndisponivel(obs.deteccoes) ? undefined : obs.deteccoes.dimensoes;

  // Variante B: so cronologia, sem dados locais — os subsistemas ficam marcados
  // como nao executados para nao sugerir "indisponivel" (nao houve tentativa).
  if (!incluirDadosLocais) {
    const naoExecutado = { status: "nao_carregado" as const };
    return {
      observacao: {
        versao: VERSAO_ESQUEMA_CONTEXTO,
        frameId: obs.frameId,
        indice,
        capturadoEm: obs.capturadoEm,
        offsetMs,
        subsistemas: { deteccao: naoExecutado, pose: naoExecutado, maos: naoExecutado },
        deteccoes: [],
        pessoas: [],
        maos: [],
        movimento: [],
      },
      posicoes: ctx.posicoesAnteriores,
    };
  }

  const subsistemas = {
    deteccao: estadoSubsistema(obs.deteccoes, obs.metricas.subsistemas?.deteccao, (r) => r.deteccoes.length === 0),
    pose: estadoSubsistema(obs.pose, obs.metricas.subsistemas?.pose, (r) => r.pessoas.length === 0),
    maos: estadoSubsistema(obs.maos, obs.metricas.subsistemas?.maos, (r) => r.maos.length === 0),
    ...(obs.nsfw !== undefined
      ? { nsfw: estadoSubsistema(obs.nsfw, obs.metricas.subsistemas?.nsfw, (r) => r.marcacoes.length === 0) }
      : {}),
  };

  const movimento = calcularMovimento(obs, ctx.posicoesAnteriores, serializacao.decimais);

  const pessoas = serializarPessoas(obs.pose, serializacao);
  const maos = serializarMaos(obs.maos, serializacao, dimensoes);
  const deteccoes = priorizarDeteccoes(
    serializarDeteccoes(obs.deteccoes, serializacao),
    maos,
    pessoas,
    { decimais: serializacao.decimais, ...ctx.proximidadeObjetos }
  );

  const observacao: ObservacaoLocalSerializavel = {
    versao: VERSAO_ESQUEMA_CONTEXTO,
    frameId: obs.frameId,
    indice,
    capturadoEm: obs.capturadoEm,
    offsetMs,
    subsistemas,
    deteccoes,
    pessoas,
    maos,
    movimento: movimento.movimentos,
  };
  if (obs.nsfw !== undefined) {
    observacao.nsfw = serializarNsfw(obs.nsfw, dimensoes, serializacao);
  }
  return { observacao, posicoes: movimento.posicoes };
}

function serializarEvento(
  evento: PacoteCiclo["eventosTemporais"][number],
  decimais: number
): EventoTemporalSerializavel {
  const serializado: EventoTemporalSerializavel = {
    eventoId: evento.eventoId,
    tipo: evento.tipo,
    descricao: evento.descricao,
    inicioEm: evento.inicioEm,
    status: evento.estado,
    evidencias: evento.frameIds.slice(0, 8),
  };
  if (evento.fimEm !== undefined) serializado.fimEm = evento.fimEm;
  if (evento.ultimaEvidenciaEm !== undefined) {
    serializado.ultimaEvidenciaEm = evento.ultimaEvidenciaEm;
  }
  if (evento.ultimaObservacaoEm !== undefined) {
    serializado.ultimaObservacaoEm = evento.ultimaObservacaoEm;
  }
  if (evento.entidadeId !== undefined) serializado.trackId = evento.entidadeId;
  if (evento.participantes !== undefined && evento.participantes.length > 0) {
    serializado.participantes = [...evento.participantes];
  }
  if (evento.confianca !== undefined) serializado.confianca = arredondar(evento.confianca, decimais);
  if (evento.intervaloSemObservacaoMs !== undefined) {
    serializado.gapMs = evento.intervaloSemObservacaoMs;
  }
  if (evento.motivoEncerramento !== undefined) {
    serializado.motivoEncerramento = evento.motivoEncerramento;
  }
  if (evento.continuidadeValida !== undefined) {
    serializado.continuidadeValida = evento.continuidadeValida;
  }
  if (evento.evidencias !== undefined && evento.evidencias.length > 0) {
    serializado.evidenciasTextuais = evento.evidencias.slice(0, 8);
  }
  return serializado;
}

/** Mantem no maximo `max` frames, preservando o primeiro e o ultimo. */
function amostrar<T>(itens: T[], max: number): T[] {
  if (itens.length <= max) return itens;
  if (max <= 1) return [itens[itens.length - 1]];
  const passo = (itens.length - 1) / (max - 1);
  const resultado: T[] = [];
  for (let i = 0; i < max; i += 1) {
    resultado.push(itens[Math.round(i * passo)]);
  }
  return resultado;
}

function coletarIndisponibilidades(observacoes: ObservacaoFrame[]): string[] {
  const vistos = new Set<string>();
  observacoes.forEach((obs, i) => {
    const pares: Array<[string, ResultadoOuIndisponivel<unknown> | undefined]> = [
      ["deteccao", obs.deteccoes],
      ["pose", obs.pose],
      ["maos", obs.maos],
      // `nsfw` undefined = subsistema desligado: nao e indisponibilidade.
      ["nsfw", obs.nsfw],
    ];
    for (const [nome, res] of pares) {
      // `nao_amostrado` = pulado pela cadencia, nao falha. Nao entra na lista de
      // indisponibilidades (o prompt ja recebe o estado por frame).
      if (estaIndisponivel(res) && !naoFoiAmostrado(res)) {
        vistos.add(`frame ${i + 1}: ${nome} indisponivel (${res.motivo})`);
      }
    }
  });
  return [...vistos];
}
