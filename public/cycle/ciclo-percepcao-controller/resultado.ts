import type {
  EntradaLog,
  EventoTemporalEnvio,
  EventoVisual,
} from "../../../src/types";
import type {
  ConfiguracaoCiclo,
  PacoteCiclo,
  ResultadoCiclo,
} from "../../../src/domain/cycle";
import {
  reduzirFrequenciaAdaptativa,
  type SinalFrequenciaAdaptativa,
} from "../../../src/domain/frequencia-adaptativa";
import { criarCycleId, uuid } from "../../../src/domain/ids";
import { estaIndisponivel } from "../../../src/domain/perception";
import type { DependenciasCicloMultiframe } from "../ciclo-multiframe";
import type { ItemHistorico } from "../cycle-controller";
import { aplicarPolitica, decidirInterpretacao } from "../politica-ciclo";
import { caixasDe } from "./tipos";
import { BaseCicloPercepcaoController } from "./base";

export class CicloPercepcaoController extends BaseCicloPercepcaoController {
  protected dependenciasCiclo(): DependenciasCicloMultiframe {
    return {
      captura: this.captura,
      store: this.store,
      processarFrame: this.variante().percepcaoLocal
        ? this.percepcao.processarFrame
        : this.processarInativo,
      interpretador: this.interpretadorAtual ?? this.deps.criarInterpretador(),
      motorTemporal: this.motorTemporal ?? undefined,
      sessaoId: this.sessaoId,
      proximoCycleId: () => criarCycleId(this.sessaoId, (this.cicloSeq += 1)),
      decidirInterpretacao: (resumoTemporal) => {
        const decisao = decidirInterpretacao(this.politicaCiclo, resumoTemporal, {
          disparoManual: this.disparoManualPendente,
        });
        return { interpretar: decisao.interpretar, motivo: decisao.motivo };
      },
      obterPolitica: () =>
        aplicarPolitica(this.politicaCiclo, this.estadoFrequencia.modo),
      obterConfiguracaoCiclo: (): ConfiguracaoCiclo => ({
        varianteId: this.variante().id,
        quantidadeSnapshotsConfigurada: this.configuracaoCaptura.quadros,
        intervaloEntreSnapshotsMs: this.configuracaoCaptura.intervaloMs,
        intervaloAgendamentoMs: this.deps.obterIntervaloMs(),
        ...(this.interpretadorAtual?.diagnostico
          ? { interpretador: this.interpretadorAtual.diagnostico }
          : {}),
      }),
      persistirCiclo: (registro) => this.deps.repositorio.gravarCiclo(registro),
      obterCargaModelos: () => this.cargaModelosAtual,
      obterLatenciaEntreCiclosMs: () =>
        this.ultimoFimCicloMs === null
          ? undefined
          : Math.round(performance.now() - this.ultimoFimCicloMs),
      registrarFimCiclo: (fimMs) => {
        this.ultimoFimCicloMs = fimMs;
      },
    };
  }

  /**
   * Traduz o resultado do ciclo em `EventoUi`: caixas do ultimo frame, entrada
   * com a interpretacao e status. Um ciclo sem frames nao gera entrada (nao ha
   * evidencia), apenas sinaliza que a camera ainda nao entregou imagem.
   */
  protected apresentarResultado(resultado: ResultadoCiclo): void {
    const { pacote } = resultado;
    this.atualizarFrequencia(pacote);
    this.ultimaDuracaoMsValor = pacote.metricas.totalMs ?? 0;
    this.ultimaPersistenciaMsValor = pacote.metricas.persistenciaMs ?? 0;
    const contextoMultimodal = pacote.metricas.contextoMultimodal;
    if (contextoMultimodal) {
      this.ciclosInterpretados += 1;
      if (contextoMultimodal.truncado) this.ciclosComTruncamento += 1;
    }

    const ultima = pacote.observacoes[pacote.observacoes.length - 1];
    if (!ultima) {
      this.status("Sem frame da camera ainda; aguardando imagem para analisar.");
      return;
    }

    if (this.deps.camera.largura > 0 && this.deps.camera.altura > 0) {
      this.deps.aoUi({
        tipo: "preparar_canvas",
        largura: this.deps.camera.largura,
        altura: this.deps.camera.altura,
      });
    }
    this.deps.aoUi({ tipo: "desenhar_caixas", objetos: caixasDe(ultima) });

    // Interpretacao suprimida pela politica (Fase 4): o frame foi observado, mas
    // nao houve nova interpretacao — sem entrada no historico. Os eventos
    // temporais e o diagnostico continuam sendo persistidos.
    if (pacote.metricas.interpretacaoSuprimida) {
      this.persistirEventosTemporais(pacote);
      this.persistirMemoriaTemporal(pacote);
      this.status(
        this.resumoStatus(pacote.cycleId, undefined, pacote.metricas.totalMs) +
          ` (interpretacao suprimida: ${pacote.metricas.interpretacaoSuprimida})`
      );
      return;
    }

    const resumo = resultado.interpretacao?.trim();
    const entrada: EntradaLog = {
      timestamp: new Date().toISOString(),
      modelo: this.interpretadorAtual?.modelo ?? "multiframe",
      objetos: [],
      resumo: resumo && resumo.length > 0 ? resumo : "sem interpretacao",
      tipo: "descricao",
      snapshot: ultima.thumb,
      capturadoEm: ultima.capturadoEm,
      frameId: ultima.frameId,
      sessaoId: pacote.sessionId,
      ms: pacote.metricas.multimodalMs,
    };
    const item = this.deps.aoUi({ tipo: "exibir_entrada", entrada });
    this.persistirEntrada(entrada, item);
    this.persistirEventosTemporais(pacote);
    this.persistirMemoriaTemporal(pacote);
    this.status(this.resumoStatus(pacote.cycleId, resumo, pacote.metricas.totalMs));
  }

  /**
   * Alimenta o redutor de frequencia com o resumo do ciclo que terminou. A
   * entrada/saida de pessoas vem do track de pose (`origens: ["pose"]`); o
   * `desaparecimento` tambem desconta o track que ainda pode estar em memoria
   * temporaria no resumo. Sem frame nao ha timestamp de referencia e o estado
   * fica congelado — ausencia de observacao nao e saida confirmada.
   */
  private atualizarFrequencia(pacote: PacoteCiclo): void {
    const config = this.politicaCiclo.frequenciaAdaptativa;
    if (!config) return;
    const ultimo = pacote.observacoes[pacote.observacoes.length - 1];
    if (!ultimo || !Number.isFinite(ultimo.capturadoEmMs)) return;

    const eventos = pacote.eventosTemporais;
    const entradas = eventos.filter(
      (evento) =>
        evento.tipo === "aparicao" &&
        evento.origens.includes("pose") &&
        (evento.estado === "confirmado" || evento.estado === "provavel")
    );
    const saidas = eventos.filter(
      (evento) =>
        evento.tipo === "desaparecimento" &&
        evento.origens.includes("pose") &&
        evento.estado === "confirmado"
    );
    const sinal: SinalFrequenciaAdaptativa = {
      tempoMs: ultimo.capturadoEmMs,
      pessoasAtivas: Math.max(0, pacote.resumoTemporal.pessoasAtivas - saidas.length),
      entrouPessoa: entradas.length > 0,
      saiuPessoa: saidas.length > 0,
    };
    this.estadoFrequencia = reduzirFrequenciaAdaptativa(
      this.estadoFrequencia,
      sinal,
      config
    );
  }

  private resumoStatus(cycleId: string, resumo: string | undefined, totalMs?: number): string {
    const texto = resumo && resumo.length > 0 ? resumo : "sem interpretacao";
    const duracao = totalMs === undefined ? "" : ` (${totalMs} ms)`;
    return `Ciclo ${cycleId}: ${texto}${duracao}`;
  }

  private persistirEntrada(entrada: EntradaLog, item: ItemHistorico | void): void {
    this.deps.fila.agendar({
      descricao: "entrada:multiframe",
      payload: entrada,
      executar: () => this.deps.repositorio.gravarEntrada(entrada),
      aoFalhar: () => item?.marcarNaoGravado(),
    });
  }

  /**
   * Persiste os eventos temporais do ciclo como `EventoVisual` — mesmo
   * arquivo (`eventos.jsonl`) e API dos demais modos, para que
   * `npm run qualidade` meça cada variante (Etapa 9) sobre os mesmos eventos.
   *
   * Um `EventoTemporal` tem identidade unica e e atualizado entre ciclos, entao:
   * - **uma gravacao por `eventoId`** (o Set `eventosPersistidos` evita duplicar
   *   a mesma identidade a cada ciclo em que ela aparece);
   * - **so `confirmado`/`encerrado`**: candidato/incerto nunca vira fato;
   * - `timestamp` = `inicioEm` (o instante real do acontecimento, nao o fim da
   *   confirmacao) — e o que o casamento da avaliacao usa.
   *
   * Tipos sem equivalente em `EventoVisual` (`gesto_detectado`,
   * `braco_levantado`, `transicao_acao`, `movimento_corporal`,
   * `pose_compativel_sexual`) nao entram neste stream: vao para a memoria
   * temporal propria em `persistirMemoriaTemporal`. `movimento_objeto`
   * e adaptado ao rótulo visual legado `movimento` com origem semantica explícita.
   */
  private persistirEventosTemporais(pacote: PacoteCiclo): void {
    for (const evt of pacote.eventosTemporais) {
      if (this.eventosPersistidos.has(evt.eventoId)) continue;
      if (evt.estado !== "confirmado" && evt.estado !== "encerrado") continue;
      if (
        evt.tipo !== "aparicao" &&
        evt.tipo !== "desaparecimento" &&
        evt.tipo !== "mudanca_de_cena" &&
        evt.tipo !== "movimento_objeto"
      ) {
        continue;
      }
      this.eventosPersistidos.add(evt.eventoId);

      // Evidencia: o ultimo frame do evento; sem ele, o ultimo frame do ciclo.
      const ultimoFrameId = evt.frameIds[evt.frameIds.length - 1];
      const obs =
        pacote.observacoes.find((o) => o.frameId === ultimoFrameId) ??
        pacote.observacoes[pacote.observacoes.length - 1];
      const modeloDeteccao =
        obs && !estaIndisponivel(obs.deteccoes) ? obs.deteccoes.modelo : undefined;
      const evento: EventoVisual = {
        id: evt.eventoId,
        timestamp: evt.inicioEm,
        tipo: evt.tipo === "movimento_objeto" ? "movimento" : evt.tipo,
        objetoId: evt.entidadeId,
        rotuloObjeto: evt.rotuloObjeto,
        descricao: evt.descricao,
        confianca: evt.confianca,
        origem: "rastreador",
        origensSinal: evt.origens,
        snapshot: obs?.thumb,
        modelo: modeloDeteccao,
        sessaoId: pacote.sessionId,
        idempotencyKey: uuid(),
        frameId: obs?.frameId,
      };
      this.deps.fila.agendar({
        descricao: `evento:multiframe:${evt.tipo}`,
        payload: evento,
        executar: () => this.deps.repositorio.gravarEvento(evento),
      });
    }
  }

  /**
   * Persiste a memoria pesquisavel de gestos/posturas/movimento corporal no
   * stream temporal (`eventos-temporais.jsonl`), separado dos fatos visuais.
   *
   * - so `gesto_detectado`, `braco_levantado`, `transicao_acao`,
   *   `movimento_corporal`, `pose_compativel_sexual` e `interacao_objeto`
   *   entram;
   * - `candidato` nunca vira memoria; `provavel`, `confirmado`, `encerrado` e
   *   `incerto` entram, cada um uma unica vez por `eventoId:estado`;
   * - `incerto` preserva `intervaloSemObservacaoMs`, para distinguir "o sinal
   *   parou" de "a observacao parou";
   * - a chave de idempotencia e estavel (`eventoId:estado`), entao uma
   *   retentativa da fila nao duplica a atualizacao no servidor.
   */
  private persistirMemoriaTemporal(pacote: PacoteCiclo): void {
    for (const evt of pacote.eventosTemporais) {
      if (
        evt.tipo !== "gesto_detectado" &&
        evt.tipo !== "braco_levantado" &&
        evt.tipo !== "transicao_acao" &&
        evt.tipo !== "movimento_corporal" &&
        evt.tipo !== "pose_compativel_sexual" &&
        evt.tipo !== "interacao_objeto"
      ) {
        continue;
      }
      if (
        evt.estado !== "provavel" &&
        evt.estado !== "confirmado" &&
        evt.estado !== "encerrado" &&
        evt.estado !== "incerto"
      ) {
        continue;
      }
      const chave = `${evt.eventoId}:${evt.estado}`;
      if (this.memoriaTemporalPersistida.has(chave)) continue;
      this.memoriaTemporalPersistida.add(chave);

      const evento: EventoTemporalEnvio = {
        eventoId: evt.eventoId,
        sessionId: evt.sessionId,
        cycleId: evt.cycleId,
        tipo: evt.tipo,
        inicioEm: evt.inicioEm,
        fimEm: evt.fimEm,
        ultimaEvidenciaEm: evt.ultimaEvidenciaEm,
        ultimaObservacaoEm: evt.ultimaObservacaoEm,
        entidadeId: evt.entidadeId,
        participantes: evt.participantes,
        rotuloObjeto: evt.rotuloObjeto,
        descricao: evt.descricao,
        confianca: evt.confianca,
        origens: evt.origens,
        frameIds: evt.frameIds,
        estado: evt.estado,
        intervaloSemObservacaoMs: evt.intervaloSemObservacaoMs,
        motivoEncerramento: evt.motivoEncerramento,
        continuidadeValida: evt.continuidadeValida,
        evidencias: evt.evidencias,
        idempotencyKey: chave,
      };
      this.deps.fila.agendar({
        descricao: `memoria:${evt.tipo}:${evt.estado}`,
        payload: evento,
        executar: () => this.deps.repositorio.gravarEventoTemporal(evento),
      });
    }
  }
}
