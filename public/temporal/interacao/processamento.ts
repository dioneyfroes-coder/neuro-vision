import { distanciaPontos } from "../suavizador";
import type { EventoTemporal } from "../../../src/domain";
import type { AmostraInteracao, OpcoesProcessarInteracao } from "./tipos";
import { centroDaCaixa, chavePar, pontoNaCaixa, arredondar } from "./geometria";
import { adicionarEvidencia, adicionarFrame, eventoDe } from "./evento";
import { ORDEM_GRAU } from "./tipos";
import { BaseDetectorInteracao } from "./base";

export class DetectorInteracao extends BaseDetectorInteracao {
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
      adicionarFrame(par.frameIds, amostra.frameId);
      adicionarEvidencia(par.evidencias, `distancia:${arredondar(distancia)}`);
      if (sobreposto) {
        par.framesSobreposicao += 1;
        adicionarEvidencia(par.evidencias, "sobreposicao:punho_na_caixa");
      } else {
        par.framesSobreposicao = 0;
      }
      if (objetoMoveu) {
        adicionarEvidencia(par.evidencias, `objeto_moveu:${arredondar(deslocamento)}`);
      }

      const grau = this.calcularGrau(par, objetoMoveu);
      if (ORDEM_GRAU[grau] > ORDEM_GRAU[par.grauMaximo]) par.grauMaximo = grau;
      if (!par.emitido || ORDEM_GRAU[grau] > ORDEM_GRAU[par.grau]) {
        par.grau = grau;
        par.emitido = true;
        emitidos.push(eventoDe(par, grau));
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
}
