import { distanciaPontos, type Ponto2D } from "../suavizador";
import { uuid } from "../../../src/domain/ids";
import type { EventoTemporal } from "../../../src/domain";
import { CONFIG_INTERACAO_PADRAO } from "./tipos";
import type { AmostraInteracao, ConfigInteracao, EstadoPar, GrauInteracao } from "./tipos";
import { chaveParIds } from "./geometria";
import { adicionarFrame, eventoDe } from "./evento";

export abstract class BaseDetectorInteracao {
  protected readonly config: ConfigInteracao;
  protected readonly pares = new Map<string, EstadoPar>();

  constructor(config?: Partial<ConfigInteracao>) {
    this.config = { ...CONFIG_INTERACAO_PADRAO, ...config };
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
      const evento = eventoDe(par, "incerto", {
        ...this.config,
        motivoEncerramento: "periodo_cego",
      });
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
  protected calcularGrau(par: EstadoPar, objetoMoveu: boolean): GrauInteracao {
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

  protected deslocamentoObjeto(
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

  protected novoPar(amostra: AmostraInteracao, chave: string): EstadoPar {
    return {
      chave,
      sessionId: amostra.sessionId,
      maoEntidadeId: amostra.maoEntidadeId,
      objetoEntidadeId: amostra.objetoEntidadeId,
      pessoaEntidadeId: amostra.pessoaEntidadeId,
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
      framesObjetoEstavel: 0,
      possePegoEmitida: false,
    };
  }

  protected encerrar(
    par: EstadoPar,
    referencia: { frameId?: string },
    motivo: "sem_sinal" | "oclusao"
  ): EventoTemporal | null {
    const observado = par.emitido || par.frameIds.length > 0;
    this.pares.delete(par.chave);
    if (!observado) return null;
    const evento = eventoDe(par, "encerrado", {
      ...this.config,
      motivoEncerramento: motivo,
    });
    evento.motivoEncerramento = motivo;
    if (referencia.frameId) adicionarFrame(evento.frameIds, referencia.frameId);
    return evento;
  }
}
