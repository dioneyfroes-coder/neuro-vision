import type { ConfigMaquinaSinais } from "./contracts";
import { CONFIG_MAQUINA_PADRAO } from "./contracts";
import { uuid } from "../../src/domain/ids";

/**
 * Leitura de um sinal para uma entidade em um frame.
 *
 * `rotulo` e o sinal observado (ex.: nome do gesto, ou `"levantado"` para o
 * braco). `null` indica que **nao ha sinal valido** neste frame para a entidade
 * (mão oculta, gesto abaixo do limiar, inferencia falha, etc.) — distinto de
 * ausencia da propria entidade.
 */
export interface LeituraSinal {
  entidadeId: string;
  rotulo: string | null;
  confianca: number;
  frameId: string;
  timestamp: string;
  cycleId: string;
}

/**
 * Evento de sinal emitido pela maquina, com identidade estavel por todo o
 * ciclo de vida (confirmacao e encerramento compartilham o mesmo `eventoId`).
 */
export interface EventoSinal {
  eventoId: string;
  entidadeId: string;
  rotulo: string;
  estado: "confirmado" | "encerrado";
  inicioEm: string;
  fimEm?: string;
  frameIds: string[];
  confianca: number;
  cycleIdInicio: string;
  /** Frames em que o sinal foi observado (evidencia). */
  framesSinal: number;
}

interface Ativo {
  eventoId: string;
  entidadeId: string;
  rotulo: string;
  inicioEm: string;
  cycleIdInicio: string;
  frameIds: string[];
  confianca: number;
  framesSinal: number;
}

interface EstadoEntidade {
  rotuloCandidato: string | null;
  framesCandidato: number;
  frameIdsCandidato: string[];
  inicioCandidato: string | null;
  cycleIdCandidato: string | null;
  framesSemSinal: number;
  ativo: Ativo | null;
}

/**
 * Maquina de estados de sinal com confirmacao e encerramento temporais.
 *
 * - Um sinal precisa persistir por `framesParaConfirmar` frames para ser
 *   confirmado (filtra gestos instaveis de um unico frame).
 * - Um evento confirmado so encerra apos `framesParaEncerrar` frames sem o
 *   sinal (filtra ocultacoes breves).
 * - O evento confirmado inclui todos os frames de evidencia (candidato e
 *   permanencia) e dura de `inicioEm` a `fimEm`.
 * - O estado e reutilizado entre ciclos; `limpar()` reseta tudo.
 */
export class MaquinaSinais {
  private readonly config: ConfigMaquinaSinais;
  private readonly estados = new Map<string, EstadoEntidade>();

  constructor(config?: Partial<ConfigMaquinaSinais>) {
    this.config = { ...CONFIG_MAQUINA_PADRAO, ...config };
  }

  /**
   * Processa as leituras de um frame e retorna os eventos emitidos neste
   * passo (confirmacoes e encerramentos).
   */
  processar(leituras: LeituraSinal[]): EventoSinal[] {
    const emitidos: EventoSinal[] = [];
    const vistas = new Set<string>();

    for (const leitura of leituras) {
      vistas.add(leitura.entidadeId);
      const valida =
        leitura.rotulo !== null && leitura.confianca >= this.config.confiancaMinima;

      let estado = this.estados.get(leitura.entidadeId);
      if (!estado) {
        estado = this.novoEstado();
        this.estados.set(leitura.entidadeId, estado);
      }

      if (valida && leitura.rotulo !== null) {
        estado.framesSemSinal = 0;

        // O sinal ativo continua: apenas estende a evidencia.
        if (estado.ativo && estado.ativo.rotulo === leitura.rotulo) {
          this.estender(estado.ativo, leitura);
          continue;
        }

        // Troca de sinal encerra o ativo anterior antes de avaliar o novo.
        if (estado.ativo) {
          emitidos.push(this.eventoDe(estado.ativo, "encerrado", leitura.timestamp));
          estado.ativo = null;
        }

        if (estado.rotuloCandidato === leitura.rotulo) {
          estado.framesCandidato += 1;
          this.adicionarFrame(estado.frameIdsCandidato, leitura.frameId);
        } else {
          estado.rotuloCandidato = leitura.rotulo;
          estado.framesCandidato = 1;
          estado.frameIdsCandidato = [leitura.frameId];
          estado.inicioCandidato = leitura.timestamp;
          estado.cycleIdCandidato = leitura.cycleId;
        }

        if (!estado.ativo && estado.framesCandidato >= this.config.framesParaConfirmar) {
          estado.ativo = this.iniciar(leitura, estado);
          emitidos.push(this.eventoDe(estado.ativo, "confirmado"));
        }
      } else {
        // Sem sinal valido neste frame.
        estado.framesSemSinal += 1;
        this.resetarCandidato(estado);
        if (estado.ativo && estado.framesSemSinal >= this.config.framesParaEncerrar) {
          emitidos.push(this.eventoDe(estado.ativo, "encerrado", leitura.timestamp));
          estado.ativo = null;
        }
      }
    }

    // Entidades que sumiram completamente do frame tambem contam como "sem sinal".
    for (const [entidadeId, estado] of this.estados) {
      if (vistas.has(entidadeId)) continue;
      estado.framesSemSinal += 1;
      if (estado.ativo && estado.framesSemSinal >= this.config.framesParaEncerrar) {
        const referencia = this.ultimaReferenciaDeTempo(estado.ativo);
        emitidos.push(this.eventoDe(estado.ativo, "encerrado", referencia.timestamp));
        estado.ativo = null;
      }
      // Retencao: sem evento ativo e sem sinal ha tempo, descarta o estado.
      if (!estado.ativo && estado.framesSemSinal > this.config.framesParaEncerrar) {
        this.estados.delete(entidadeId);
      }
    }

    return emitidos;
  }

  /** Eventos ativos (confirmados e ainda em curso). */
  ativos(): Ativo[] {
    const lista: Ativo[] = [];
    for (const estado of this.estados.values()) {
      if (estado.ativo) lista.push(estado.ativo);
    }
    return lista;
  }

  limpar(): void {
    this.estados.clear();
  }

  private novoEstado(): EstadoEntidade {
    return {
      rotuloCandidato: null,
      framesCandidato: 0,
      frameIdsCandidato: [],
      inicioCandidato: null,
      cycleIdCandidato: null,
      framesSemSinal: 0,
      ativo: null,
    };
  }

  private resetarCandidato(estado: EstadoEntidade): void {
    estado.rotuloCandidato = null;
    estado.framesCandidato = 0;
    estado.frameIdsCandidato = [];
    estado.inicioCandidato = null;
    estado.cycleIdCandidato = null;
  }

  private iniciar(leitura: LeituraSinal, estado: EstadoEntidade): Ativo {
    return {
      eventoId: uuid(),
      entidadeId: leitura.entidadeId,
      rotulo: leitura.rotulo as string,
      inicioEm: estado.inicioCandidato ?? leitura.timestamp,
      cycleIdInicio: estado.cycleIdCandidato ?? leitura.cycleId,
      frameIds: [...estado.frameIdsCandidato],
      confianca: leitura.confianca,
      framesSinal: estado.frameIdsCandidato.length,
    };
  }

  private estender(ativo: Ativo, leitura: LeituraSinal): void {
    this.adicionarFrame(ativo.frameIds, leitura.frameId);
    ativo.confianca = Math.max(ativo.confianca, leitura.confianca);
    ativo.framesSinal += 1;
  }

  private adicionarFrame(frameIds: string[], frameId: string): void {
    if (frameIds[frameIds.length - 1] !== frameId) frameIds.push(frameId);
  }

  private eventoDe(
    ativo: Ativo,
    estado: "confirmado" | "encerrado",
    fimEm?: string
  ): EventoSinal {
    return {
      eventoId: ativo.eventoId,
      entidadeId: ativo.entidadeId,
      rotulo: ativo.rotulo,
      estado,
      inicioEm: ativo.inicioEm,
      fimEm: estado === "encerrado" ? fimEm : undefined,
      frameIds: [...ativo.frameIds],
      confianca: ativo.confianca,
      cycleIdInicio: ativo.cycleIdInicio,
      framesSinal: ativo.framesSinal,
    };
  }

  /**
   * Referencia de tempo/frame para encerrar uma entidade que desapareceu do
   * frame: usa o ultimo frame de evidencia registrado.
   */
  private ultimaReferenciaDeTempo(ativo: Ativo): { timestamp: string; frameId: string } {
    const frameId = ativo.frameIds[ativo.frameIds.length - 1] ?? "";
    return { timestamp: ativo.inicioEm, frameId };
  }
}
