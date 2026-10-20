import { estaIndisponivel } from "../../src/domain";
import type {
  ObservacaoFrame,
  PacoteCiclo,
  PontoCorporal,
  ResultadoDeteccaoLocal,
  ResultadoMaos,
  ResultadoNsfw,
  ResultadoOuIndisponivel,
  ResultadoPose,
} from "../../src/domain";

/**
 * Montagem do contexto estruturado de um ciclo (Etapa 7 do roteiro).
 *
 * Converte o `PacoteCiclo` num resumo **estruturado e limitado** por frame:
 * contagem de deteccoes, pose e maos resumidas, poucos pontos relevantes e os
 * eventos temporais. Substitui "enviar todos os landmarks em texto" por um
 * resumo por frame + pontos relevantes, com teto de tamanho.
 *
 * Cada frame do contexto corresponde a **uma imagem**, na mesma ordem; o campo
 * `indice` (1-based) liga o texto enviado ao modelo a imagem correta.
 */

export interface LimitesContexto {
  /** Maximo de imagens/frames enviados (os mais recentes). */
  maxImagens: number;
  /** Maximo de eventos temporais incluidos. */
  maxEventos: number;
  /** Maximo de pontos corporais relevantes por frame. */
  maxPontosPorFrame: number;
  /** Casas decimais para coordenadas/confiancas (limita dados numericos). */
  decimais: number;
  /** Teto aproximado do JSON do contexto (bytes). */
  maxBytesContexto: number;
}

export const LIMITES_CONTEXTO_PADRAO: LimitesContexto = {
  maxImagens: 4,
  maxEventos: 20,
  maxPontosPorFrame: 6,
  decimais: 2,
  maxBytesContexto: 16_000,
};

export interface PontoRelevante {
  nome: string;
  x: number;
  y: number;
}

export interface ResumoFrame {
  frameId: string;
  /** Indice 1-based da imagem correspondente, na ordem enviada. */
  indice: number;
  capturadoEm: string;
  /** Deslocamento em ms em relacao ao primeiro frame da janela. */
  offsetMs: number;
  deteccoes: string;
  pose: string;
  maos: string;
  /**
   * Marcacoes NSFW (experimental). **Opcional**: presente apenas quando o
   * subsistema rodou neste frame (toggle ligado) — com o toggle desligado o
   * campo e omitido do payload, como se o subsistema nao existisse.
   */
  nsfw?: string;
  pontos: PontoRelevante[];
}

export interface EventoTemporalResumo {
  tipo: string;
  descricao: string;
  inicioEm: string;
  fimEm?: string;
  confianca?: number;
  frameIds: string[];
}

export interface ContextoCicloSerializavel {
  sessionId: string;
  cycleId: string;
  iniciadoEm: string;
  /** Duracao total observada da janela (ms). */
  janelaMs: number;
  frames: ResumoFrame[];
  eventosTemporais: EventoTemporalResumo[];
  resumoTemporal: {
    entidadesAtivas: number;
    houveIntervaloSemObservacao: boolean;
    /** Duracao (ms) do periodo cego anterior ao ciclo, quando houver. */
    intervaloSemObservacaoMs?: number;
  };
  /** Sinalizacao clara de subsistemas indisponiveis (falha != ausencia). */
  indisponibilidades: string[];
}

export interface PayloadContexto {
  /** Imagens (data URL) na ordem dos frames do contexto. */
  imagens: string[];
  contexto: ContextoCicloSerializavel;
}

/** Opcoes de montagem do contexto (Etapa 9). */
export interface OpcoesContexto {
  /**
   * Inclui no contexto os dados derivados da percepcao local (deteccoes, pose,
   * maos, pontos e eventos temporais). Na variante B (`false`) vao ao multimodal
   * apenas as imagens e a cronologia (`frameId`, `indice`, `capturadoEm`,
   * `offsetMs`), para isolar o valor do contexto entre imagens.
   */
  incluirDadosLocais?: boolean;
}

/** Indices COCO dos pontos corporais relevantes (nariz e punhos). */
const PONTOS_RELEVANTES: Array<{ indice: number; nome: string }> = [
  { indice: 0, nome: "nariz" },
  { indice: 9, nome: "punho_esquerdo" },
  { indice: 10, nome: "punho_direito" },
];

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
  const incluirDadosLocais = opcoes.incluirDadosLocais ?? true;
  const ordenadas = [...pacote.observacoes].sort((a, b) => a.capturadoEmMs - b.capturadoEmMs);
  const selecionadas = amostrar(ordenadas, cfg.maxImagens);
  const baseMs = selecionadas.length > 0 ? selecionadas[0].capturadoEmMs : 0;

  const frames: ResumoFrame[] = selecionadas.map((obs, i) => ({
    frameId: obs.frameId,
    indice: i + 1,
    capturadoEm: obs.capturadoEm,
    offsetMs: Math.round(obs.capturadoEmMs - baseMs),
    deteccoes: incluirDadosLocais ? resumirDeteccoes(obs.deteccoes, cfg.decimais) : "",
    pose: incluirDadosLocais ? resumirPose(obs.pose) : "",
    maos: incluirDadosLocais ? resumirMaos(obs.maos, cfg.decimais) : "",
    // NSFW experimental: so entra no contexto (e portanto ao gemma) quando o
    // subsistema RODOU neste frame (toggle ligado) e os dados locais vao ao
    // multimodal. Toggle desligado = campo omitido por completo.
    ...(incluirDadosLocais && obs.nsfw !== undefined
      ? { nsfw: resumirNsfw(obs.nsfw, cfg.decimais) }
      : {}),
    pontos: incluirDadosLocais ? pontosRelevantes(obs.pose, cfg.maxPontosPorFrame, cfg.decimais) : [],
  }));

  const eventosTemporais = incluirDadosLocais
    ? pacote.eventosTemporais.slice(0, cfg.maxEventos).map((e) => ({
        tipo: e.tipo,
        descricao: e.descricao,
        inicioEm: e.inicioEm,
        fimEm: e.fimEm,
        confianca: e.confianca === undefined ? undefined : arredondar(e.confianca, cfg.decimais),
        frameIds: e.frameIds.slice(0, 8),
      }))
    : [];

  const indisponibilidades = incluirDadosLocais ? coletarIndisponibilidades(ordenadas) : [];

  const janelaMs =
    ordenadas.length > 1
      ? Math.round(ordenadas[ordenadas.length - 1].capturadoEmMs - ordenadas[0].capturadoEmMs)
      : 0;

  const contexto: ContextoCicloSerializavel = {
    sessionId: pacote.sessionId,
    cycleId: pacote.cycleId,
    iniciadoEm: pacote.iniciadoEm,
    janelaMs,
    frames,
    eventosTemporais,
    resumoTemporal: {
      entidadesAtivas: incluirDadosLocais ? pacote.resumoTemporal.entidadesAtivas : 0,
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

function resumirDeteccoes(
  resultado: ResultadoOuIndisponivel<ResultadoDeteccaoLocal>,
  decimais: number
): string {
  if (estaIndisponivel(resultado)) return `indisponivel (${resultado.motivo})`;
  if (resultado.deteccoes.length === 0) return "nenhuma deteccao";
  const contagem = new Map<string, number>();
  let maior = 0;
  for (const d of resultado.deteccoes) {
    const nome = d.nome || d.rotulo || "objeto";
    contagem.set(nome, (contagem.get(nome) ?? 0) + 1);
    maior = Math.max(maior, d.score);
  }
  const partes = [...contagem.entries()].map(([nome, n]) => `${n}x ${nome}`);
  return `${partes.join(", ")} (conf. max ${arredondar(maior, decimais)})`;
}

function resumirPose(resultado: ResultadoOuIndisponivel<ResultadoPose>): string {
  if (estaIndisponivel(resultado)) return `indisponivel (${resultado.motivo})`;
  if (resultado.pessoas.length === 0) return "nenhuma pessoa";
  const descricoes = resultado.pessoas.map((p, i) => {
    const validos = p.pontos.filter(
      (pt) => pt.confianca === undefined || pt.confianca >= 0.3
    ).length;
    return `pessoa ${i + 1} (${validos} pontos)`;
  });
  return descricoes.join(", ");
}

function resumirMaos(
  resultado: ResultadoOuIndisponivel<ResultadoMaos>,
  decimais: number
): string {
  if (estaIndisponivel(resultado)) return `indisponivel (${resultado.motivo})`;
  if (resultado.maos.length === 0) return "nenhuma mao";
  return resultado.maos
    .map((m) => {
      const gesto = m.gesto
        ? `, gesto ${m.gesto.nome} (${arredondar(m.gesto.confianca, decimais)})`
        : "";
      return `mao ${m.lateralidade}${gesto}`;
    })
    .join("; ");
}

/** Resumo das marcacoes NSFW (rotulos vem do proprio modelo, em ingles). */
function resumirNsfw(resultado: ResultadoOuIndisponivel<ResultadoNsfw>, decimais: number): string {
  if (estaIndisponivel(resultado)) return `indisponivel (${resultado.motivo})`;
  if (resultado.marcacoes.length === 0) return "nenhuma marcacao";
  return resultado.marcacoes
    .map((m) => `${m.rotulo} (${arredondar(m.score, decimais)})`)
    .join(", ");
}

function pontosRelevantes(
  resultado: ResultadoOuIndisponivel<ResultadoPose>,
  max: number,
  decimais: number
): PontoRelevante[] {
  if (estaIndisponivel(resultado) || resultado.pessoas.length === 0) return [];
  const pessoa = resultado.pessoas[0];
  const pontos: PontoRelevante[] = [];
  for (const { indice, nome } of PONTOS_RELEVANTES) {
    if (pontos.length >= max) break;
    const pt: PontoCorporal | undefined = pessoa.pontos[indice];
    if (!pt) continue;
    if (pt.confianca !== undefined && pt.confianca < 0.3) continue;
    pontos.push({ nome, x: arredondar(pt.x, decimais), y: arredondar(pt.y, decimais) });
  }
  return pontos;
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

function arredondar(valor: number, decimais: number): number {
  if (!Number.isFinite(valor)) return 0;
  const fator = 10 ** decimais;
  return Math.round(valor * fator) / fator;
}

/**
 * Reduz o contexto ate caber no teto, sem quebrar a correspondencia entre
 * frame e imagem: primeiro remove pontos, depois eventos, depois descricoes
 * longas ficam truncadas.
 */
function limitarPorBytes(contexto: ContextoCicloSerializavel, maxBytes: number): void {
  if (tamanhoBytes(contexto) <= maxBytes) return;
  for (const frame of contexto.frames) {
    if (frame.pontos.length > 0) {
      frame.pontos = [];
      if (tamanhoBytes(contexto) <= maxBytes) return;
    }
  }
  if (contexto.eventosTemporais.length > 0) {
    contexto.eventosTemporais = [];
    if (tamanhoBytes(contexto) <= maxBytes) return;
  }
  for (const frame of contexto.frames) {
    frame.deteccoes = truncar(frame.deteccoes, 120);
    frame.pose = truncar(frame.pose, 120);
    frame.maos = truncar(frame.maos, 120);
    if (frame.nsfw !== undefined) frame.nsfw = truncar(frame.nsfw, 120);
  }
}

function truncar(texto: string, max: number): string {
  return texto.length > max ? `${texto.slice(0, max - 1)}…` : texto;
}

function tamanhoBytes(valor: unknown): number {
  return JSON.stringify(valor).length;
}
