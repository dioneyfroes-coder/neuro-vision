import { BaseMaquinaSinais } from "./base";
import type {
  EventoSinal,
  LeituraSinal,
  MotivoEncerramento,
  OpcoesProcessarSinais,
} from "./tipos";

/**
 * Maquina de estados de sinal com confirmacao e encerramento temporais.
 *
 * - Um sinal precisa persistir por `framesParaConfirmar` frames **validos** para
 *   ser confirmado (filtra gestos instaveis de um unico frame).
 * - Um evento confirmado so encerra apos `framesParaEncerrar` frames validos
 *   sem o sinal (filtra ocultacoes breves).
 * - A **troca de sinal** (`troca_sinal`) so encerra o ativo quando o novo sinal
 *   se sustenta por `framesParaConfirmar` frames: um unico frame com rotulo
 *   diferente nao trunca o evento nem afirma uma transicao nao observada.
 * - `fimEm` e sempre a ultima evidencia positiva; a identidade (`eventoId`) e
 *   estavel.
 * - Uma inferencia indisponivel nao conta como ausencia: o evento ativo e
 *   preservado e o candidato reinicia.
 * - O estado e reutilizado entre ciclos; `limpar()` reseta tudo.
 */
export class MaquinaSinais extends BaseMaquinaSinais {
  processar(leituras: LeituraSinal[], opcoes: OpcoesProcessarSinais = {}): EventoSinal[] {
    const emitidos: EventoSinal[] = [];
    this.encerradosNesteProcessamento = [];

    // Inferencia indisponivel: nao observamos nada. Preserva ativos (nao
    // afirma encerramento), reinicia candidatos (confirmacao exige frames
    // validos contiguos) e nao incrementa `framesSemSinal`.
    if (opcoes.indisponivel) {
      for (const estado of this.estados.values()) this.resetarCandidato(estado);
      return emitidos;
    }

    const vistas = new Set<string>();

    for (const leitura of leituras) {
      vistas.add(leitura.entidadeId);
      const valida =
        leitura.rotulo !== null && leitura.confianca >= this.config.confiancaMinima;

      let estado = this.estados.get(leitura.entidadeId);
      if (!estado) {
        estado = this.novoEstado(leitura.entidadeId);
        this.estados.set(leitura.entidadeId, estado);
      }

      if (valida && leitura.rotulo !== null) {
        estado.framesSemSinal = 0;

        // O sinal ativo continua: apenas estende a evidencia. Um candidato de
        // outro rotulo visto antes nao sobrevive a volta do sinal original.
        if (estado.ativo && estado.ativo.rotulo === leitura.rotulo) {
          this.resetarCandidato(estado);
          this.estender(estado.ativo, leitura);
          continue;
        }

        // Outro sinal valido no mesmo track. A entidade foi observada neste
        // frame (ainda que com outro sinal), entao `ultimaObservacaoEm` avanca
        // sem alterar a ultima evidencia positiva do ativo.
        if (estado.ativo) {
          estado.ativo.ultimaObservacaoEm = leitura.timestamp;
          if (leitura.continuidadeValida === false) {
            estado.ativo.continuidadeValida = false;
          }
        }

        if (estado.rotuloCandidato === leitura.rotulo) {
          estado.framesCandidato += 1;
          estado.confiancaCandidato = Math.max(
            estado.confiancaCandidato,
            leitura.confianca
          );
          this.acumularEvidencias(estado.evidenciasCandidato, leitura.evidencias);
          this.adicionarFrame(estado.frameIdsCandidato, leitura.frameId);
        } else {
          estado.rotuloCandidato = leitura.rotulo;
          estado.framesCandidato = 1;
          estado.frameIdsCandidato = [leitura.frameId];
          estado.inicioCandidato = leitura.timestamp;
          estado.cycleIdCandidato = leitura.cycleId;
          estado.confiancaCandidato = leitura.confianca;
          estado.evidenciasCandidato = [...(leitura.evidencias ?? [])];
        }

        // A troca so acontece quando o **novo** sinal se sustenta por
        // `framesParaConfirmar`. Um unico frame com rotulo diferente (flicker do
        // classificador) nao encerra o ativo: encerrar por `troca_sinal` sem que
        // o substituto exista afirmaria uma transicao que nao foi observada.
        if (estado.framesCandidato >= this.config.framesParaConfirmar) {
          if (estado.ativo) emitidos.push(this.encerrar(estado, "troca_sinal"));
          estado.ativo = this.iniciar(leitura, estado);
          emitidos.push(this.eventoDe(estado.ativo, "confirmado"));
        }
      } else {
        // Sem sinal valido neste frame. Se a entidade foi de fato observada
        // (mesmo sem sinal), a ultima observacao avanca; se ela apenas segue na
        // janela de tolerancia do rastreador, a observacao NAO avanca.
        const motivo: MotivoEncerramento =
          leitura.observada === false ? "oclusao" : "sem_sinal";
        estado.motivoUltimaAusencia = motivo;
        if (estado.ativo) {
          if (leitura.observada !== false) {
            estado.ativo.ultimaObservacaoEm = leitura.timestamp;
          }
          if (leitura.continuidadeValida === false) {
            estado.ativo.continuidadeValida = false;
          }
        }
        estado.framesSemSinal += 1;
        this.resetarCandidato(estado);
        if (estado.ativo && estado.framesSemSinal >= this.config.framesParaEncerrar) {
          emitidos.push(this.encerrar(estado, motivo));
        }
      }
    }

    // Entidades que sumiram completamente do frame deixaram de ser vistas: o
    // encerramento e por oclusao, nao por "sinal ausente observado".
    for (const [entidadeId, estado] of this.estados) {
      if (vistas.has(entidadeId)) continue;
      estado.motivoUltimaAusencia = "oclusao";
      estado.framesSemSinal += 1;
      if (estado.ativo && estado.framesSemSinal >= this.config.framesParaEncerrar) {
        emitidos.push(this.encerrar(estado, "oclusao"));
      }
      // Retencao: sem evento ativo e sem sinal ha tempo, descarta o estado.
      if (!estado.ativo && estado.framesSemSinal > this.config.framesParaEncerrar) {
        this.estados.delete(entidadeId);
      }
    }

    return emitidos;
  }
}
