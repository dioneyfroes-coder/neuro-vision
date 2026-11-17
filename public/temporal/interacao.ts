import { distanciaPontos, type Ponto2D } from "./suavizador";
import { uuid } from "../../src/domain/ids";
import type { EventoTemporal, OrigemSinalTemporal } from "../../src/domain";

/**
 * Detector de interacoes mão↔objeto (Fase 4, itens 5–7) — regra pura.
 *
 * O ponto central deste modulo e a barra de evidencia:
 *
 * - **proximidade não é contato.** Aproximar a mao de um objeto, mesmo por
 *   varios frames, no maximo sustenta um evento `provavel`;
 * - **contato confirmado** exige sobreposicao sustentada do punho com a caixa
 *   do objeto **e** uma mudanca de estado do objeto observada no mesmo periodo
 *   (o objeto se deslocou com intervalo temporal valido). Sem essa corroboracao
 *   o evento fica `provavel`, com a descricao explicando o que falta;
 * - evidencia fraca, curta ou com continuidade invalida gera `incerto`, nunca
 *   uma conclusao de contato;
 * - o fim do evento e sempre a **ultima evidencia positiva**, e a identificacao
 *   (`eventoId`) e estavel entre os graus e o encerramento.
 *
 * Nenhuma funcao le relogio, DOM ou API de navegador: o tempo vem de
 * `timestamp`/`tempoMs` da amostra, para testes deterministicos.
 */

/** Grau de evidencia de uma interacao (mapeado para `EstadoEventoTemporal`). */
export type GrauInteracao = "incerto" | "provavel" | "confirmado";

/** Caixa normalizada pelo tamanho do frame (mesmo espaco dos landmarks). */
export interface CaixaNormalizada {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}

/**
 * Uma amostra por par (mao, objeto) em um frame. So existe quando **ambos** os
 * subsistemas (maos e deteccoes) produziram resultado: falha de inferencia e
 * tratada com `opcoes.indisponivel` em `processar`, nao como ausencia de par.
 */
export interface AmostraInteracao {
  sessionId: string;
  maoEntidadeId: string;
  objetoEntidadeId: string;
  rotuloObjeto?: string;
  /** Punho da mao (landmark 0), normalizado. */
  punhoMao: Ponto2D;
  /** Caixa do objeto normalizada pelo tamanho do frame. */
  caixaObjeto: CaixaNormalizada;
  confianca: number;
  frameId: string;
  timestamp: string;
  tempoMs: number;
  cycleId: string;
  /** `false` quando mão ou objeto nao foi visto neste frame (oclusao). */
  observado: boolean;
  /** `false` quando o intervalo/associacao nao pode ser validado. */
  continuidadeValida: boolean;
}

export interface ConfigInteracao {
  /** Distancia normalizada punho↔centro da caixa para contar como proximidade. */
  raioProximidade: number;
  /** Margem normalizada aplicada a caixa no teste de sobreposicao do punho. */
  margemCaixa: number;
  /** Confianca minima (mao e objeto) para a amostra entrar na regra. */
  confiancaMinima: number;
  /** Frames de proximidade sustentada antes de classificar como `provavel`. */
  framesParaProvavel: number;
  /** Frames de sobreposicao antes de permitir `confirmado` (com corroboracao). */
  framesParaContato: number;
  /** Deslocamento normalizado do objeto que conta como mudanca de estado. */
  deslocamentoMinimoObjeto: number;
  /** Intervalo maximo (ms) para o deslocamento do objeto ser confiavel. */
  intervaloMaximoMs: number;
  /** Frames sem evidencia antes de encerrar a interacao ativa. */
  framesParaEncerrar: number;
}

export const CONFIG_INTERACAO_PADRAO: ConfigInteracao = {
  raioProximidade: 0.15,
  margemCaixa: 0.02,
  confiancaMinima: 0.5,
  framesParaProvavel: 2,
  framesParaContato: 3,
  deslocamentoMinimoObjeto: 0.02,
  intervaloMaximoMs: 2000,
  framesParaEncerrar: 3,
};

/** Opcoes de `processar` para distinguir "sem par" de "nao foi possivel ver". */
export interface OpcoesProcessarInteracao {
  /**
   * `true` quando maos ou deteccoes falharam neste frame. A detectora congela
   * o estado (nao conta ausencia, nao confirma, nao encerra): uma inferencia
   * que falhou nao afirma que a interacao terminou.
   */
  indisponivel?: boolean;
}

interface EstadoPar {
  chave: string;
  sessionId: string;
  maoEntidadeId: string;
  objetoEntidadeId: string;
  rotuloObjeto?: string;
  eventoId: string;
  inicioEm: string;
  cycleIdInicio: string;
  ultimaEvidenciaEm: string;
  ultimaObservacaoEm: string;
  frameIds: string[];
  evidencias: string[];
  confianca: number;
  grau: GrauInteracao;
  grauMaximo: GrauInteracao;
  /** Ja emitiu ao menos um evento neste ciclo de vida (evita encerrar o nunca visto). */
  emitido: boolean;
  framesProximidade: number;
  framesSobreposicao: number;
  framesSemSinal: number;
  continuidadeValida: boolean;
  /** Ultimo centro do objeto e o instante, para medir mudanca de estado. */
  ultimoCentro: Ponto2D | null;
  ultimoTempoMs: number | null;
}

const ORDEM_GRAU: Record<GrauInteracao, number> = {
  incerto: 0,
  provavel: 1,
  confirmado: 2,
};

/**
 * Maquina de estados por par mao↔objeto. `processar` devolve somente eventos
 * emitidos neste passo (primeira observacao, escaladas e encerramento), todos
 * com o mesmo `eventoId` dentro de um ciclo de vida.
 */
export class DetectorInteracao {
  private readonly config: ConfigInteracao;
  private readonly pares = new Map<string, EstadoPar>();

  constructor(config?: Partial<ConfigInteracao>) {
    this.config = { ...CONFIG_INTERACAO_PADRAO, ...config };
  }

  processar(
    amostras: AmostraInteracao[],
    opcoes: OpcoesProcessarInteracao = {}
  ): EventoTemporal[] {
    if (opcoes.indisponivel) return [];
    const emitidos: EventoTemporal[] = [];
    const vistos = new Set<string>();

    for (const amostra of amostras) {
      const chave = chavePar(amostra);
      vistos.add(chave);
      let par = this.pares.get(chave);
      if (!par) {
        par = this.novoPar(amostra, chave);
        this.pares.set(chave, par);
      } else {
        par.rotuloObjeto = amostra.rotuloObjeto ?? par.rotuloObjeto;
      }

      const centro = centroDaCaixa(amostra.caixaObjeto);
      const distancia = distanciaPontos(amostra.punhoMao, centro);
      const sobreposto = pontoNaCaixa(
        amostra.punhoMao,
        amostra.caixaObjeto,
        this.config.margemCaixa
      );
      const proximo =
        distancia <= this.config.raioProximidade || sobreposto;
      const validate =
        amostra.confianca >= this.config.confiancaMinima &&
        amostra.observado &&
        Number.isFinite(distancia);

      if (!validate) {
        // Entidade observada sem o par/evidencia (ou oclusao): conta ausencia,
        // mas nao apaga a evidencia ja coletada.
        par.framesSemSinal += 1;
        if (amostra.observado === false) par.continuidadeValida = false;
        if (par.framesSemSinal >= this.config.framesParaEncerrar) {
          const encerrado = this.encerrar(
            par,
            amostra,
            amostra.observado === false ? "oclusao" : "sem_sinal"
          );
          if (encerrado) emitidos.push(encerrado);
        }
        continue;
      }

      par.ultimaObservacaoEm = amostra.timestamp;
      if (amostra.continuidadeValida === false) par.continuidadeValida = false;
      par.confianca = Math.max(par.confianca, amostra.confianca);

      // Mudanca de estado do objeto so conta com intervalo valido: nao se
      // presume deslocamento atraves de uma lacuna ou associacao duvidosa.
      const deslocamento = this.deslocamentoObjeto(par, centro, amostra);
      const objetoMoveu =
        deslocamento !== null &&
        deslocamento >= this.config.deslocamentoMinimoObjeto &&
        amostra.continuidadeValida !== false;

      if (!proximo) {
        // O objeto continua observado, mas a mao se afastou: nao ha evidencia
        // de interacao neste frame. Nao encerra imediatamente (histderese via
        // `framesSemSinal` e tratada acima); apenas nao avanca a proximidade.
        par.framesProximidade = 0;
        par.framesSobreposicao = 0;
        par.framesSemSinal += 1;
        if (par.framesSemSinal >= this.config.framesParaEncerrar) {
          const encerrado = this.encerrar(par, amostra, "sem_sinal");
          if (encerrado) emitidos.push(encerrado);
        }
        continue;
      }

      // Evidencia positiva de proximidade.
      par.framesSemSinal = 0;
      par.framesProximidade += 1;
      par.ultimaEvidenciaEm = amostra.timestamp;
      this.adicionarFrame(par.frameIds, amostra.frameId);
      this.adicionarEvidencia(par.evidencias, `distancia:${arredondar(distancia)}`);
      if (sobreposto) {
        par.framesSobreposicao += 1;
        this.adicionarEvidencia(par.evidencias, "sobreposicao:punho_na_caixa");
      } else {
        par.framesSobreposicao = 0;
      }
      if (objetoMoveu) {
        this.adicionarEvidencia(par.evidencias, `objeto_moveu:${arredondar(deslocamento)}`);
      }

      const grau = this.calcularGrau(par, objetoMoveu);
      if (ORDEM_GRAU[grau] > ORDEM_GRAU[par.grauMaximo]) par.grauMaximo = grau;
      if (!par.emitido || ORDEM_GRAU[grau] > ORDEM_GRAU[par.grau]) {
        par.grau = grau;
        par.emitido = true;
        emitidos.push(this.eventoDe(par, grau));
      }
    }

    // Pares que nao apareceram no frame deixaram de ser vistos: oclusao.
    for (const [chave, par] of this.pares) {
      if (vistos.has(chave)) continue;
      par.framesSemSinal += 1;
      par.continuidadeValida = false;
      if (par.framesSemSinal >= this.config.framesParaEncerrar) {
        const encerrado = this.encerrar(par, {}, "oclusao");
        if (encerrado) emitidos.push(encerrado);
      }
    }

    return emitidos;
  }

  /**
   * Interrompe interacoes ativas por um periodo cego entre ciclos. O fim e a
   * ultima evidencia positiva, o estado fica `incerto` e a continuidade e
   * marcada como invalida: uma lacuna nao prova que o contato terminou.
   */
  interromperPorPeriodoCego(gapMs?: number): EventoTemporal[] {
    const emitidos: EventoTemporal[] = [];
    for (const par of [...this.pares.values()]) {
      if (!par.emitido) continue;
      const evento = this.eventoDe(par, "incerto");
      evento.motivoEncerramento = "periodo_cego";
      evento.intervaloSemObservacaoMs = gapMs;
      evento.continuidadeValida = false;
      emitidos.push(evento);
      this.pares.delete(chaveParIds(par.maoEntidadeId, par.objetoEntidadeId));
    }
    return emitidos;
  }

  /** Limpa todo o estado (sessao explicita). */
  limpar(): void {
    this.pares.clear();
  }

  /** Pares correntes, para observabilidade/testes. */
  estados(): ReadonlyArray<{
    chave: string;
    grau: GrauInteracao;
    framesProximidade: number;
    framesSobreposicao: number;
  }> {
    return [...this.pares.values()].map((par) => ({
      chave: par.chave,
      grau: par.grau,
      framesProximidade: par.framesProximidade,
      framesSobreposicao: par.framesSobreposicao,
    }));
  }

  /**
   * Grau derivado da evidencia acumulada. A rota para `confirmado` passa
   * **necessariamente** por sobreposicao sustentada + mudanca de estado do
   * objeto; proximidade isolada para em `provavel`.
   */
  private calcularGrau(par: EstadoPar, objetoMoveu: boolean): GrauInteracao {
    const sustentada = par.framesProximidade >= this.config.framesParaProvavel;
    // Continuidade invalida nunca promove a evidencia: no maximo `incerto`.
    if (!sustentada || !par.continuidadeValida) return "incerto";
    if (
      par.framesSobreposicao >= this.config.framesParaContato &&
      objetoMoveu
    ) {
      return "confirmado";
    }
    return "provavel";
  }

  private deslocamentoObjeto(
    par: EstadoPar,
    centro: Ponto2D,
    amostra: AmostraInteracao
  ): number | null {
    const anterior = par.ultimoCentro;
    par.ultimoCentro = centro;
    const anteriorTempo = par.ultimoTempoMs;
    par.ultimoTempoMs = amostra.tempoMs;
    if (!anterior || anteriorTempo === null) return null;
    const intervalo = amostra.tempoMs - anteriorTempo;
    if (
      !Number.isFinite(intervalo) ||
      intervalo <= 0 ||
      intervalo > this.config.intervaloMaximoMs
    ) {
      return null;
    }
    return distanciaPontos(anterior, centro);
  }

  private novoPar(amostra: AmostraInteracao, chave: string): EstadoPar {
    return {
      chave,
      sessionId: amostra.sessionId,
      maoEntidadeId: amostra.maoEntidadeId,
      objetoEntidadeId: amostra.objetoEntidadeId,
      rotuloObjeto: amostra.rotuloObjeto,
      eventoId: uuid(),
      inicioEm: amostra.timestamp,
      cycleIdInicio: amostra.cycleId,
      ultimaEvidenciaEm: amostra.timestamp,
      ultimaObservacaoEm: amostra.timestamp,
      frameIds: [],
      evidencias: [],
      confianca: amostra.confianca,
      grau: "incerto",
      grauMaximo: "incerto",
      emitido: false,
      framesProximidade: 0,
      framesSobreposicao: 0,
      framesSemSinal: 0,
      continuidadeValida: amostra.continuidadeValida !== false,
      ultimoCentro: null,
      ultimoTempoMs: null,
    };
  }

  private encerrar(
    par: EstadoPar,
    referencia: { frameId?: string },
    motivo: "sem_sinal" | "oclusao"
  ): EventoTemporal | null {
    const observado = par.emitido || par.frameIds.length > 0;
    this.pares.delete(par.chave);
    if (!observado) return null;
    const evento = this.eventoDe(par, "encerrado");
    evento.motivoEncerramento = motivo;
    if (referencia.frameId) this.adicionarFrame(evento.frameIds, referencia.frameId);
    return evento;
  }

  private eventoDe(par: EstadoPar, estado: "incerto" | "provavel" | "confirmado" | "encerrado"): EventoTemporal {
    const descricao =
      estado === "confirmado"
        ? `Contato confirmado entre mao e${par.rotuloObjeto ? ` ${par.rotuloObjeto}` : " objeto"} (sobreposicao sustentada e mudanca de estado observada)`
        : estado === "provavel"
          ? `Provavel interacao com${par.rotuloObjeto ? ` ${par.rotuloObjeto}` : " objeto"} (proximidade sustentada; contato nao confirmado)`
          : estado === "incerto"
            ? `Proximidade entre mao e${par.rotuloObjeto ? ` ${par.rotuloObjeto}` : " objeto"} observada; contato nao confirmado`
            : `Interacao encerrada (grau maximo: ${par.grauMaximo})`;
    return {
      eventoId: par.eventoId,
      sessionId: par.sessionId,
      cycleId: par.cycleIdInicio,
      tipo: "interacao_objeto",
      inicioEm: par.inicioEm,
      fimEm: estado === "encerrado" ? par.ultimaEvidenciaEm : undefined,
      ultimaEvidenciaEm: par.ultimaEvidenciaEm,
      ultimaObservacaoEm: par.ultimaObservacaoEm,
      entidadeId: par.objetoEntidadeId,
      participantes: [par.maoEntidadeId, par.objetoEntidadeId],
      rotuloObjeto: par.rotuloObjeto,
      descricao,
      confianca: par.confianca,
      origens: ["maos", "objetos"] as OrigemSinalTemporal[],
      frameIds: [...par.frameIds],
      estado,
      motivoEncerramento: estado === "encerrado" ? "sem_sinal" : undefined,
      continuidadeValida: par.continuidadeValida,
      evidencias: [...par.evidencias, `grau:${par.grauMaximo}`],
    };
  }

  private adicionarFrame(frames: string[], frameId: string | undefined): void {
    if (!frameId) return;
    if (frames[frames.length - 1] !== frameId) frames.push(frameId);
  }

  private adicionarEvidencia(evidencias: string[], evidencia: string): void {
    if (evidencias.includes(evidencia)) return;
    if (evidencias.length >= 12) return;
    evidencias.push(evidencia);
  }
}

function chavePar(amostra: AmostraInteracao): string {
  return chaveParIds(amostra.maoEntidadeId, amostra.objetoEntidadeId);
}

function chaveParIds(mao: string, objeto: string): string {
  return `${mao}|${objeto}`;
}

function centroDaCaixa(caixa: CaixaNormalizada): Ponto2D {
  return {
    x: (caixa.xmin + caixa.xmax) / 2,
    y: (caixa.ymin + caixa.ymax) / 2,
  };
}

/** `true` quando o punho esta dentro da caixa (com margem opcional). */
function pontoNaCaixa(
  ponto: Ponto2D,
  caixa: CaixaNormalizada,
  margem: number
): boolean {
  return (
    ponto.x >= caixa.xmin - margem &&
    ponto.x <= caixa.xmax + margem &&
    ponto.y >= caixa.ymin - margem &&
    ponto.y <= caixa.ymax + margem
  );
}

function arredondar(valor: number, casas = 3): number {
  const fator = 10 ** casas;
  return Math.round(valor * fator) / fator;
}
