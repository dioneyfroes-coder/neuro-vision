import { estaIndisponivel } from "../../src/domain";
import type {
  DiagnosticoContextoMultimodal,
  ObservacaoFrame,
  PacoteCiclo,
  ResultadoOuIndisponivel,
} from "../../src/domain";
import {
  arredondar,
  calcularMovimento,
  estadoSubsistema,
  KEYPOINTS_ESSENCIAIS,
  serializarDeteccoes,
  serializarMaos,
  serializarNsfw,
  serializarPessoas,
  OPCOES_SERIALIZACAO_PADRAO,
  VERSAO_ESQUEMA_CONTEXTO,
  type ContextoCicloSerializavel,
  type EventoTemporalSerializavel,
  type GrupoTruncamento,
  type ObservacaoLocalSerializavel,
  type OpcoesSerializacao,
} from "./esquema";

/** Reexporta o schema versionado para consumidores do contexto. */
export * from "./esquema";

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

export interface LimitesContexto {
  /** Maximo de imagens/frames enviados (os mais recentes). */
  maxImagens: number;
  /** Maximo de eventos temporais incluidos. */
  maxEventos: number;
  /** Maximo de pontos corporais relevantes por frame (legado; ver `opcoes`). */
  maxPontosPorFrame: number;
  /** Casas decimais para coordenadas/confiancas (limita dados numericos). */
  decimais: number;
  /** Teto do JSON do contexto em **bytes UTF-8** (nao unidades de string). */
  maxBytesContexto: number;
}

export const LIMITES_CONTEXTO_PADRAO: LimitesContexto = {
  maxImagens: 4,
  maxEventos: 20,
  maxPontosPorFrame: 6,
  decimais: 2,
  maxBytesContexto: 16_000,
};

export interface PayloadContexto {
  /** Imagens (data URL) na ordem dos frames do contexto. */
  imagens: string[];
  contexto: ContextoCicloSerializavel;
}

/** Opcoes de montagem do contexto (Etapa 9). */
export interface OpcoesContexto {
  /**
   * Inclui no contexto os dados derivados da percepcao local (deteccoes, pose,
   * maos, movimento e eventos temporais). Na variante B (`false`) vao ao
   * multimodal apenas as imagens e a cronologia (`frameId`, `indice`,
   * `capturadoEm`, `offsetMs`), para isolar o valor do contexto entre imagens.
   */
  incluirDadosLocais?: boolean;
  /**
   * Serializacao do schema (decimais, keypoints, limites por frame). Default:
   * `OPCOES_SERIALIZACAO_PADRAO`, com `decimais` herdado de `LimitesContexto`.
   */
  serializacao?: Partial<OpcoesSerializacao>;
}

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

/** Resultado interno da montagem de um frame, com o mapa de posicoes. */
interface FrameMontado {
  observacao: ObservacaoLocalSerializavel;
  posicoes: Map<string, { x: number; y: number; tMs: number }>;
}

function montarObservacao(
  obs: ObservacaoFrame,
  indice: number,
  offsetMs: number,
  ctx: {
    incluirDadosLocais: boolean;
    serializacao: OpcoesSerializacao;
    posicoesAnteriores: Map<string, { x: number; y: number; tMs: number }>;
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

  const observacao: ObservacaoLocalSerializavel = {
    versao: VERSAO_ESQUEMA_CONTEXTO,
    frameId: obs.frameId,
    indice,
    capturadoEm: obs.capturadoEm,
    offsetMs,
    subsistemas,
    deteccoes: serializarDeteccoes(obs.deteccoes, serializacao),
    pessoas: serializarPessoas(obs.pose, serializacao),
    maos: serializarMaos(obs.maos, serializacao),
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
      if (estaIndisponivel(res)) {
        vistos.add(`frame ${i + 1}: ${nome} indisponivel (${res.motivo})`);
      }
    }
  });
  return [...vistos];
}

/** Quantidade minima de evidencia textual de um evento preservada na compactacao. */
const MIN_EVIDENCIAS_EVENTO = 1;
/** Evidencias de frame mantidas por evento antes de uma poda mais agressiva. */
const MAX_EVIDENCIAS_EVENTO = 4;
/**
 * Margem reservada para o proprio registro `truncamento`, para que registrar a
 * poda nao empurre o payload de volta acima do teto.
 */
const RESERVA_TRUNCAMENTO_BYTES = 320;

/**
 * Reduz o contexto ate caber no teto, sem quebrar a correspondencia entre
 * frame e imagem. O criterio e **preservar a evidencia que sustenta uma
 * afirmacao** (Fase 3):
 *
 * 1. compacta landmarks de mao (mantendo gesto e geometria);
 * 2. reduz keypoints nao essenciais, preservando ombros, cotovelos, pulsos e
 *    quadris de cada pessoa;
 * 3. remove movimento (derivavel das posicoes);
 * 4. compacta evidencias de frames dos eventos, mantendo ao menos uma por
 *    evento (nunca ha perda silenciosa da unica evidencia);
 * 5. remove eventos nao confirmados (`candidato`/`incerto`); eventos
 *    `confirmado`/`encerrado` sao preservados;
 * 6. reduz deteccoes/pessoas/maos, priorizando maos com gesto ou geometria.
 *
 * `frameId`, timestamp, `versao`, o estado do subsistema, as **marcacoes NSFW**
 * e os eventos confirmados nunca sao removidos: quando o classificador esta
 * ativo, a informacao +18 e evidencia essencial. O teto e medido em **bytes
 * UTF-8** (`TextEncoder`), nao em unidades de string.
 *
 * Sempre que ha reducao, `contexto.truncamento` registra os grupos podados e as
 * contagens. Se o payload continuar acima do teto apos todas as reducoes, o
 * contexto tambem registra `limiteContexto` com `excedeu: true` — nunca falha em
 * silencio.
 */
function limitarPorBytes(contexto: ContextoCicloSerializavel, maxBytes: number): void {
  const bytesAntes = tamanhoBytesUtf8(contexto);
  if (bytesAntes <= maxBytes) return;

  const remocoes = new Map<GrupoTruncamento, number>();
  const registrar = (grupo: GrupoTruncamento, removidos: number): void => {
    if (removidos <= 0) return;
    remocoes.set(grupo, (remocoes.get(grupo) ?? 0) + removidos);
  };
  // A reserva evita que o proprio metadado de truncamento estoure o teto.
  const cabe = (): boolean => tamanhoBytesUtf8(contexto) <= maxBytes - RESERVA_TRUNCAMENTO_BYTES;

  // 1. Landmarks de mao: mantem apenas pontas/articulacoes compactas. O gesto e
  // a geometria (calculada sobre os 21 pontos brutos) permanecem intactos.
  let removidos = 0;
  for (const frame of contexto.frames) {
    for (const mao of frame.maos) {
      if (mao.landmarks.length > 6) {
        removidos += mao.landmarks.length - 6;
        mao.landmarks = mao.landmarks.slice(0, 6);
        // O registro deixa de representar os 21 landmarks.
        mao.landmarksCompletos = false;
      }
    }
  }
  registrar("landmarks_mao", removidos);
  if (cabe()) return finalizar();

  // 2. Keypoints: preserva os essenciais (ombros, cotovelos, pulsos, quadris) e
  // completa com os demais mais confiaveis ate o limite compacto.
  const essenciais = new Set(KEYPOINTS_ESSENCIAIS);
  removidos = 0;
  for (const frame of contexto.frames) {
    for (const pessoa of frame.pessoas) {
      const pontosEssenciais = pessoa.keypoints.filter((k) => essenciais.has(k.nome));
      const outros = pessoa.keypoints.filter((k) => !essenciais.has(k.nome));
      const limiteOutros = Math.max(0, 6 - pontosEssenciais.length);
      const manter = new Set([...pontosEssenciais, ...outros.slice(0, limiteOutros)]);
      const reduzidos = pessoa.keypoints.filter((k) => manter.has(k));
      removidos += pessoa.keypoints.length - reduzidos.length;
      pessoa.keypoints = reduzidos;
    }
  }
  registrar("keypoints", removidos);
  if (cabe()) return finalizar();

  // 3. Movimento (derivavel de posicoes; menos critico que a evidencia bruta).
  removidos = 0;
  for (const frame of contexto.frames) {
    removidos += frame.movimento.length;
    frame.movimento = [];
  }
  registrar("movimento", removidos);
  if (cabe()) return finalizar();

  // 4. Evidencias de frames dos eventos: preserva a primeira e as mais recentes,
  // nunca abaixo de uma evidencia por evento.
  removidos = 0;
  for (const evento of contexto.eventosTemporais) {
    if (evento.evidencias.length > MAX_EVIDENCIAS_EVENTO) {
      const manter = Math.max(MIN_EVIDENCIAS_EVENTO, MAX_EVIDENCIAS_EVENTO - 1);
      const primeira = evento.evidencias[0];
      const ultimas = evento.evidencias.slice(-manter);
      const reduzidas = [...new Set([primeira, ...ultimas])];
      removidos += evento.evidencias.length - reduzidas.length;
      evento.evidencias = reduzidas;
    }
  }
  registrar("evidencias_eventos", removidos);
  if (cabe()) return finalizar();

  // 5. Eventos nao confirmados: candidato/incerto sao hipoteses; confirmado e
  // encerrado continuam preservados como evidencia do que foi observado.
  const naoPreservados = contexto.eventosTemporais.filter(
    (evento) => evento.status !== "confirmado" && evento.status !== "encerrado"
  ).length;
  if (naoPreservados > 0) {
    contexto.eventosTemporais = contexto.eventosTemporais.filter(
      (evento) => evento.status === "confirmado" || evento.status === "encerrado"
    );
    registrar("eventos_nao_confirmados", naoPreservados);
  }
  if (cabe()) return finalizar();

  // 6. Deteccoes/pessoas/maos. Maos com gesto ou geometria tem prioridade: sao a
  // evidencia direta de configuracao de dedos/gesto.
  let removidosDeteccoes = 0;
  let removidosPessoas = 0;
  let removidosMaos = 0;
  for (const frame of contexto.frames) {
    removidosDeteccoes += Math.max(0, frame.deteccoes.length - 3);
    frame.deteccoes = frame.deteccoes.slice(0, 3);
    removidosPessoas += Math.max(0, frame.pessoas.length - 2);
    frame.pessoas = frame.pessoas.slice(0, 2);
    const maosPriorizadas = [
      ...frame.maos.filter((mao) => mao.gesto || mao.geometria),
      ...frame.maos.filter((mao) => !mao.gesto && !mao.geometria),
    ];
    removidosMaos += Math.max(0, maosPriorizadas.length - 2);
    frame.maos = maosPriorizadas.slice(0, 2);
  }
  registrar("deteccoes", removidosDeteccoes);
  registrar("pessoas", removidosPessoas);
  registrar("maos", removidosMaos);
  if (cabe()) return finalizar();

  // 7. Ultimo passo nao destrutivo: mantem uma deteccao/pessoa/mao por frame,
  // ainda priorizando maos com gesto/geometria.
  removidosDeteccoes = 0;
  removidosPessoas = 0;
  removidosMaos = 0;
  for (const frame of contexto.frames) {
    removidosDeteccoes += Math.max(0, frame.deteccoes.length - 1);
    frame.deteccoes = frame.deteccoes.slice(0, 1);
    removidosPessoas += Math.max(0, frame.pessoas.length - 1);
    frame.pessoas = frame.pessoas.slice(0, 1);
    removidosMaos += Math.max(0, frame.maos.length - 1);
    frame.maos = frame.maos.slice(0, 1);
  }
  registrar("deteccoes", removidosDeteccoes);
  registrar("pessoas", removidosPessoas);
  registrar("maos", removidosMaos);
  finalizar();

  function finalizar(): void {
    if (remocoes.size === 0) {
      // Sem grupos podaveis, o teto pode ainda ser inalcancavel (payload minimo
      // maior que o limite). Registra explicitamente em vez de falhar em silencio.
      const bytes = tamanhoBytesUtf8(contexto);
      if (bytes > maxBytes) {
        contexto.limiteContexto = { maxBytes, bytes, excedeu: true };
      }
      return;
    }
    const bytesDepois = tamanhoBytesUtf8(contexto);
    const gruposRemovidos = [...remocoes.entries()].map(([grupo, total]) => ({
      grupo,
      removidos: total,
    }));
    contexto.truncamento = {
      ocorreu: true,
      maxBytes,
      bytesAntes,
      bytesDepois,
      gruposRemovidos,
      excedeuTeto: bytesDepois > maxBytes,
    };
    const bytesComRegistro = tamanhoBytesUtf8(contexto);
    const excedeu = bytesComRegistro > maxBytes;
    contexto.truncamento.excedeuTeto = excedeu;
    if (excedeu) {
      // O campo nao entra na medicao de `bytes` (medido antes dele).
      contexto.limiteContexto = { maxBytes, bytes: bytesComRegistro, excedeu: true };
    }
  }
}

/**
 * Diagnostico de compactacao do contexto enviado, derivado do proprio payload.
 *
 * Usado pelas metricas do ciclo para medir a frequencia real de truncamento
 * (Fase 3, item 5) sem depender de logs internos do montador.
 */
export function diagnosticarContexto(
  contexto: ContextoCicloSerializavel,
  maxBytesConfigurado?: number
): DiagnosticoContextoMultimodal {
  const truncamento = contexto.truncamento;
  const limite = contexto.limiteContexto;
  return {
    bytes: tamanhoBytesUtf8(contexto),
    maxBytes: truncamento?.maxBytes ?? limite?.maxBytes ?? maxBytesConfigurado ?? 0,
    truncado: Boolean(truncamento?.ocorreu),
    excedeuTeto: Boolean(truncamento?.excedeuTeto ?? limite?.excedeu),
    gruposRemovidos: truncamento?.gruposRemovidos.map((grupo) => ({ ...grupo })) ?? [],
  };
}

/**
 * Tamanho em **bytes UTF-8** da representacao JSON do valor.
 *
 * `String.length` conta unidades UTF-16: um acento ou emoji ocupa 1 unidade mas
 * 2-4 bytes. O limite do contexto e de transporte, portanto precisa da
 * codificacao real.
 */
export function tamanhoBytesUtf8(valor: unknown): number {
  const texto = JSON.stringify(valor) ?? "";
  return new TextEncoder().encode(texto).length;
}
