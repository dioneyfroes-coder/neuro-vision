import {
  estaIndisponivel,
  naoFoiAmostrado,
  type EventoTemporal,
  type MaoDetectada,
  type ObservacaoFrame,
  type PessoaPose,
  type PontoCorporal,
} from "../../../src/domain";
import type { ObjetoVisto } from "../../../src/types";
import type { MotorTemporal, ResultadoTemporal } from "../contracts";
import { centroidePontos, pontoReferenciaPose } from "../referencia-pose";
import { podeAssociarMao } from "../motor-temporal-regras";
import { associarMaosAPessoas } from "../motor-temporal-associacao";
import {
  montarAmostrasInteracao,
  montarAmostrasPresenca,
  montarLeiturasBraco,
  montarLeiturasGesto,
  montarLeiturasMovimento,
  montarLeiturasPoseSexual,
  montarLeiturasTransicao,
} from "../motor-temporal-leituras";
import {
  converterEventoVisual,
  registrarDiagnosticos,
  sinalParaEvento,
} from "../motor-temporal-eventos";
import { MotorTemporalBase } from "./base";

export class MotorTemporalImpl extends MotorTemporalBase implements MotorTemporal {
  processar(observacoes: ObservacaoFrame[]): ResultadoTemporal {
    if (observacoes.length === 0) {
      return {
        eventos: [],
        tracksAtivos: 0,
        pessoasAtivas: 0,
        maosAtivas: 0,
        objetosAtivos: 0,
        observacoes: [],
      };
    }

    const sessionId = observacoes[0].sessionId;
    const eventos: EventoTemporal[] = [];
    this.diagnosticos.clear();
    // Copias com `entidadeId` preenchido. Sao elas que alimentam os sinais e o
    // contexto serializado; as observacoes originais sao congeladas e nao mudam.
    const observacoesEnriquecidas: ObservacaoFrame[] = [];
    let houvePeriodoCego = false;
    let gapMs: number | undefined;

    const primeiroMs = observacoes[0].capturadoEmMs;
    if (
      this.ultimoTempoMs !== null &&
      primeiroMs - this.ultimoTempoMs > this.config.limiarPeriodoCegoMs
    ) {
      houvePeriodoCego = true;
      gapMs = primeiroMs - this.ultimoTempoMs;
    }

    // Periodo cego entre ciclos: nao presuma continuidade. Interrompe os sinais
    // ativos na ultima evidencia positiva e descarta candidatos, antes de
    // processar os novos frames. O fim observado e explicito (`incerto`).
    if (houvePeriodoCego) {
      for (const sinal of this.gestos.interromperPorPeriodoCego(gapMs)) {
        eventos.push(
          sinalParaEvento(sinal, "gesto_detectado", "maos", sessionId, (s) =>
            `Gesto "${s.rotulo}" interrompido por periodo cego`
          )
        );
      }
      for (const sinal of this.braco.interromperPorPeriodoCego(gapMs)) {
        eventos.push(
          sinalParaEvento(sinal, "braco_levantado", "pose", sessionId, () =>
            "Braco levantado interrompido por periodo cego"
          )
        );
      }
      for (const sinal of this.transicao.interromperPorPeriodoCego(gapMs)) {
        eventos.push(
          sinalParaEvento(sinal, "transicao_acao", "pose", sessionId, () =>
            "Transicao de acao interrompida por periodo cego"
          )
        );
      }
      for (const sinal of this.movimento.interromperPorPeriodoCego(gapMs)) {
        eventos.push(
          sinalParaEvento(sinal, "movimento_corporal", "pose", sessionId, () =>
            "Movimento corporal interrompido por periodo cego"
          )
        );
      }
      if (this.config.avaliarPoseSexual) {
        for (const sinal of this.poseSexual.interromperPorPeriodoCego(gapMs)) {
          eventos.push(
            sinalParaEvento(sinal, "pose_compativel_sexual", "pose", sessionId, () =>
              "Pose compativel interrompida por periodo cego"
            )
          );
        }
      }
      // Interacoes em curso tambem nao afirmam continuidade atraves da lacuna:
      // encerram na ultima evidencia positiva com estado `incerto`.
      for (const evento of this.interacoes.interromperPorPeriodoCego(gapMs)) {
        eventos.push(evento);
      }
      // A presenca tambem nao presume saida atraves da lacuna.
      for (const evento of this.presencas.interromperPorPeriodoCego(gapMs)) {
        eventos.push(evento);
      }
      // Uma lacuna invalida a continuidade de todos os punhos conhecidos.
      this.punhos.clear();
      this.avaliadorPose.limpar();
    }

    for (const obs of observacoes) {
      const tempoMs = obs.capturadoEmMs;
      const frameId = obs.frameId;
      const indiceEventosDoFrame = eventos.length;

      // 1. Rastreamento de objetos (logica existente de rastreamento.ts).
      let deteccoesObservadas = obs.deteccoes;
      if (!estaIndisponivel(obs.deteccoes)) {
        const objetosVistos: ObjetoVisto[] = obs.deteccoes.deteccoes.map((d) => ({
          nome: d.nome,
          rotulo: d.rotulo,
          score: d.score,
          caixa: d.caixa,
        }));
        const resultado = this.objetos.processar(objetosVistos, tempoMs, {
          timestamp: obs.capturadoEm,
          sessaoId: sessionId,
        });
        const deteccoes = obs.deteccoes.deteccoes.map((deteccao) => ({ ...deteccao }));
        for (const { indice, objetoId } of resultado.associacoes) {
          const deteccao = deteccoes[indice];
          if (deteccao) deteccao.entidadeId = objetoId;
        }
        deteccoesObservadas = { ...obs.deteccoes, deteccoes };
        for (const ev of resultado.eventos) {
          const convertido = converterEventoVisual(ev, sessionId, frameId, obs.cycleId);
          if (convertido) eventos.push(convertido);
        }
      }

      // 2. Mudanca de cena (logica existente de cena.ts).
      if (obs.assinaturaCena) {
        const evCena = this.cena.avaliar(obs.assinaturaCena, tempoMs, {
          timestamp: obs.capturadoEm,
          sessaoId: sessionId,
        });
        if (evCena) {
          const convertido = converterEventoVisual(evCena, sessionId, frameId, obs.cycleId);
          if (convertido) eventos.push(convertido);
        }
      }

      // 3–6. Leitura temporal ampliada (pose/maos + maquinas de estado). No
      // modo `basico` apenas objetos e cena (acima) sao considerados: a variante
      // C do benchmark nao deve ganhar interpretacao temporal explicita.
      if (this.config.modo === "basico") {
        observacoesEnriquecidas.push({ ...obs, deteccoes: deteccoesObservadas });
        continue;
      }

      // 3. Rastreamento de pose (pessoas) em coordenadas normalizadas. As
      // associacoes explicitas (indice da sonda -> entidadeId) permitem copiar a
      // observacao com identidade estavel sem tocar no objeto compartilhado.
      let poseObservada = obs.pose;
      let posesComTrackId: PessoaPose[] = [];
      if (!estaIndisponivel(obs.pose)) {
        const poses = obs.pose.pessoas;
        const rastreamento = this.pessoas.atualizarComAssociacoes(
          poses
            .map((p, i) => {
              // Torso/ombros/quadris: referencia estavel mesmo com mudanca de
              // postura (bracos/cabeca). O centroide de todos os keypoints fica
              // apenas como ultimo recurso dentro de `pontoReferenciaPose`.
              const referencia = pontoReferenciaPose(p.pontos);
              if (!referencia) return null;
              return {
                x: referencia.x,
                y: referencia.y,
                confianca: p.confianca ?? 0.8,
                meta: { indice: i, referenciaPose: referencia.fonte },
              };
            })
            .filter((s): s is NonNullable<typeof s> => s !== null),
          tempoMs
        );
        posesComTrackId = poses.map((p) => ({ ...p }));
        for (const { indice, entidadeId } of rastreamento.associacoes) {
          const pessoa = posesComTrackId[indice];
          if (pessoa) pessoa.entidadeId = entidadeId;
        }
        poseObservada = { ...obs.pose, pessoas: posesComTrackId };
      }
      const poseDisponivel = !estaIndisponivel(obs.pose);
      // Frame pulado pela cadencia: nao e falha nem ausencia. Os rastreadores e
      // as maquinas de sinal ignoram o frame por completo, preservando
      // candidatos e eventos ativos como se a observacao nao existisse.
      const poseNaoAmostrada = naoFoiAmostrado(obs.pose);

      // 3a. Entrada/saida de pessoas (Fase 4). O detector e alimentado pelo
      // track de pose enriquecido, entao `entidadeId` e o mesmo usado nos demais
      // eventos de pose. Frame pulado pela cadencia e preservado; falha de
      // inferencia nao conta como "a pessoa saiu".
      if (!poseNaoAmostrada) {
        const amostras = montarAmostrasPresenca(
          this.pessoas.vivas,
          posesComTrackId,
          sessionId,
          tempoMs,
          obs.capturadoEm,
          frameId,
          obs.cycleId
        );
        for (const evento of this.presencas.processar(
          amostras,
          {
            sessionId,
            frameId,
            timestamp: obs.capturadoEm,
            tempoMs,
            cycleId: obs.cycleId,
          },
          { indisponivel: !poseDisponivel }
        )) {
          eventos.push(evento);
        }

        // Quando a pose esta disponivel, ela e a fonte autoritativa de presenca
        // de pessoas: o evento de caixa COCO `person` do rastreador de objetos
        // seria um segundo par entrada/saida para a mesma entidade fisica.
        if (poseDisponivel && this.pessoas.vivas.length > 0) {
          for (let i = eventos.length - 1; i >= indiceEventosDoFrame; i -= 1) {
            const evento = eventos[i];
            const ehPresencaDeObjeto =
              (evento.tipo === "aparicao" || evento.tipo === "desaparecimento") &&
              evento.origens.includes("objetos") &&
              evento.rotuloObjeto === "person";
            if (ehPresencaDeObjeto) eventos.splice(i, 1);
          }
        }
      }

      // 4. Rastreamento de maos em coordenadas normalizadas.
      let maosObservadas = obs.maos;
      let maosComTrackId: MaoDetectada[] = [];
      if (!estaIndisponivel(obs.maos)) {
        const maosVistas = obs.maos.maos;
        const rastreamento = this.maos.atualizarComAssociacoes(
          maosVistas
            .map((m, i) => {
              const centro = centroidePontos(m.landmarks as PontoCorporal[]);
              if (!centro) return null;
              return {
                x: centro.x,
                y: centro.y,
                confianca: m.gesto?.confianca ?? 0.8,
                meta: { indice: i, lateralidade: m.lateralidade },
              };
            })
            .filter((s): s is NonNullable<typeof s> => s !== null),
          tempoMs,
          // Lateralidade e restricao de associacao: uma mao esquerda nao deve
          // herdar o ID de uma mao direita durante cruzamentos/oclusoes.
          podeAssociarMao
        );
        maosComTrackId = maosVistas.map((m) => ({ ...m }));
        for (const { indice, entidadeId } of rastreamento.associacoes) {
          const mao = maosComTrackId[indice];
          if (mao) mao.entidadeId = entidadeId;
        }
        maosObservadas = { ...obs.maos, maos: maosComTrackId };
      }
      const maosDisponivel = !estaIndisponivel(obs.maos);
      const maosNaoAmostradas = naoFoiAmostrado(obs.maos);

      // 4a. Associacao mao <-> pessoa por proximidade ao punho. Roda sobre as
      // copias enriquecidas; nao inventa associacao quando a pose/mao falhou.
      if (!poseNaoAmostrada && !maosNaoAmostradas && maosDisponivel && poseDisponivel) {
        associarMaosAPessoas(
          posesComTrackId,
          maosComTrackId,
          this.config.distanciaMaximaMaoPessoa
        );
      }

      // 5. Maquina de braco levantado (a partir da pose enriquecida).
      const leiturasBraco = montarLeiturasBraco(
        this.pessoas.vivas,
        this.braco,
        this.config,
        posesComTrackId,
        obs.capturadoEm,
        frameId,
        obs.cycleId
      );
      if (!poseNaoAmostrada) {
        for (const sinal of this.braco.processar(leiturasBraco, { indisponivel: !poseDisponivel })) {
          eventos.push(
            sinalParaEvento(sinal, "braco_levantado", "pose", sessionId, (s) =>
              s.estado === "confirmado"
                ? "Braco levantado"
                : "Braco abaixado"
            )
          );
        }
      }

      // 5a. Transicao de acao: velocidade vertical do punho. Distingue
      // "levantou o braco" (movimento) de "braco erguido" (postura mantida).
      const leiturasTransicao = montarLeiturasTransicao(
        this.pessoas.vivas,
        this.punhos,
        this.config,
        posesComTrackId,
        tempoMs,
        obs.capturadoEm,
        frameId,
        obs.cycleId,
        poseDisponivel
      );
      if (!poseNaoAmostrada) {
        for (const sinal of this.transicao.processar(leiturasTransicao, {
          indisponivel: !poseDisponivel,
        })) {
          eventos.push(
            sinalParaEvento(sinal, "transicao_acao", "pose", sessionId, (s) =>
              s.rotulo === "braco_subindo"
                ? "Braco subindo (transicao)"
                : "Braco descendo (transicao)"
            )
          );
        }
      }

      // 5b. Movimento corporal: deslocamento de pessoas rastreadas. Nao confundir
      // com `movimento_objeto` (deslocamento de objetos do detector COCO).
      const leiturasMovimento = montarLeiturasMovimento(
        this.pessoas.vivas,
        this.config,
        obs.capturadoEm,
        frameId,
        obs.cycleId
      );
      if (!poseNaoAmostrada) {
        for (const sinal of this.movimento.processar(leiturasMovimento, {
          indisponivel: !poseDisponivel,
        })) {
          eventos.push(
            sinalParaEvento(sinal, "movimento_corporal", "pose", sessionId, (s) =>
              s.estado === "confirmado"
                ? "Movimento corporal"
                : "Movimento corporal encerrado"
            )
          );
        }
      }

      // 6. Maquina de gestos (a partir das maos enriquecidas).
      const leiturasGesto = montarLeiturasGesto(
        this.maos.vivas,
        this.dedosPorEntidade,
        this.config,
        maosComTrackId,
        obs.capturadoEm,
        frameId,
        obs.cycleId,
        // Dimensoes do frame para corrigir a anisotropia dos landmarks. O
        // resultado de maos e a fonte preferida; a deteccao do mesmo frame
        // serve de fallback.
        !estaIndisponivel(obs.maos) && obs.maos.dimensoes
          ? obs.maos.dimensoes
          : !estaIndisponivel(obs.deteccoes)
            ? obs.deteccoes.dimensoes
            : undefined
      );
      if (!maosNaoAmostradas) {
        for (const sinal of this.gestos.processar(leiturasGesto, { indisponivel: !maosDisponivel })) {
          eventos.push(
            sinalParaEvento(sinal, "gesto_detectado", "maos", sessionId, (s) =>
              s.estado === "confirmado"
                ? `Gesto "${s.rotulo}" confirmado`
                : `Gesto "${s.rotulo}" encerrado`
            )
          );
        }
      }

      // 7. Pose compativel com ato sexual (Fase 7.2). So roda quando o NSFW
      // esta ativo; o evento e indicio geometrico, nunca prova do ato.
      if (this.config.avaliarPoseSexual && !poseNaoAmostrada) {
        const leiturasPose = montarLeiturasPoseSexual(
          this.pessoas.vivas,
          this.avaliadorPose,
          posesComTrackId,
          maosComTrackId,
          tempoMs,
          obs.capturadoEm,
          frameId,
          obs.cycleId,
          poseDisponivel
        );
        for (const sinal of this.poseSexual.processar(leiturasPose, {
          indisponivel: !poseDisponivel,
        })) {
          eventos.push(
            sinalParaEvento(sinal, "pose_compativel_sexual", "pose", sessionId, (s) =>
              s.estado === "confirmado"
                ? "Pose compativel com ato sexual (indicio geometrico, nao prova)"
                : "Pose compativel encerrada"
            )
          );
        }
      }

      // 7a. Interacoes mao↔objeto (Fase 4). Proximidade, sobreposicao e mudanca
      // de estado do objeto viram evidencia explicitamente graduada; so a
      // combinacao de sobreposicao sustentada + movimento do objeto confirma
      // contato. Frame pulado pela cadencia e preservado, e falha de inferencia
      // nao conta como "sem interacao".
      const deteccoesNaoAmostradas = naoFoiAmostrado(obs.deteccoes);
      if (!maosNaoAmostradas && !deteccoesNaoAmostradas) {
        const deteccoesIndisponivel = estaIndisponivel(obs.deteccoes);
        const maosIndisponivel = estaIndisponivel(obs.maos);
        const amostras = deteccoesIndisponivel
          ? []
          : montarAmostrasInteracao(
              this.maos.vivas,
              maosComTrackId,
              deteccoesObservadas,
              !estaIndisponivel(obs.deteccoes) ? obs.deteccoes.dimensoes : undefined,
              sessionId,
              tempoMs,
              obs.capturadoEm,
              frameId,
              obs.cycleId
            );
        for (const evento of this.interacoes.processar(amostras, {
          indisponivel: deteccoesIndisponivel || maosIndisponivel,
        })) {
          eventos.push(evento);
        }
      }

      // Diagnostico corrente: diferencia confirmado, ocluido, inferencia
      // indisponivel e observacao insuficiente mesmo sem evento emitido.
      if (!maosNaoAmostradas) registrarDiagnosticos(this.diagnosticos, "gesto", this.gestos, !maosDisponivel);
      if (!poseNaoAmostrada) {
        registrarDiagnosticos(this.diagnosticos, "braco", this.braco, !poseDisponivel);
        registrarDiagnosticos(this.diagnosticos, "transicao", this.transicao, !poseDisponivel);
        registrarDiagnosticos(this.diagnosticos, "movimento", this.movimento, !poseDisponivel);
        if (this.config.avaliarPoseSexual) {
          registrarDiagnosticos(this.diagnosticos, "pose_sexual", this.poseSexual, !poseDisponivel);
        }
      }

      observacoesEnriquecidas.push({
        ...obs,
        deteccoes: deteccoesObservadas,
        pose: poseObservada,
        maos: maosObservadas,
      });
    }

    this.ultimoTempoMs = observacoes[observacoes.length - 1].capturadoEmMs;

    const pessoasAtivas = this.pessoas.vivas.length;
    const maosAtivas = this.maos.vivas.length;
    const objetosAtivos = this.objetos.rastreados.length;
    // Soma de tracks, nao de entidades fisicas: pose e maos de uma mesma pessoa
    // contam separadamente (ver `ResumoTemporal`).
    const tracksAtivos = pessoasAtivas + maosAtivas + objetosAtivos;

    return {
      eventos,
      tracksAtivos,
      pessoasAtivas,
      maosAtivas,
      objetosAtivos,
      observacoes: observacoesEnriquecidas,
      diagnosticos: [...this.diagnosticos.values()],
      houveIntervaloSemObservacao: houvePeriodoCego || undefined,
      intervaloSemObservacaoMs: gapMs,
    };
  }
}
