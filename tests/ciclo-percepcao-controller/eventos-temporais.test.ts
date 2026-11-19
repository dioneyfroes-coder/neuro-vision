import { describe, expect, it } from "vitest";
import { montar, primeiro } from "../helpers/ciclo-percepcao-controller";

describe("CicloPercepcaoController — eventos temporais e persistencia", () => {
  it("camera ainda sem frame nao gera entrada nem diagnostico", async () => {
    const ctx = montar({ semFrame: true });
    await ctx.controle.iniciar();

    expect(ctx.controle.estaRodando).toBe(true);
    expect(primeiro(ctx.eventos, "exibir_entrada")).toBeUndefined();
    expect(ctx.ciclos).toHaveLength(0);
    expect(ctx.entradas).toHaveLength(0);
    ctx.controle.parar();
  });

  it("persiste eventos temporais confirmados uma unica vez como EventoVisual", async () => {
    const confirmado: EventoTemporal = {
      eventoId: "evt-1",
      sessionId: "s",
      tipo: "desaparecimento",
      inicioEm: "2026-10-19T02:00:19.500Z",
      descricao: "pessoa sai do quadro",
      confianca: 0.8,
      origens: ["objetos"],
      frameIds: [],
      estado: "confirmado",
    };
    const movimentoObjeto: EventoTemporal = {
      ...confirmado,
      eventoId: "evt-mov",
      tipo: "movimento_objeto",
      rotuloObjeto: "bottle",
      descricao: "caneca se desloca para a direita",
    };
    const candidato: EventoTemporal = {
      ...confirmado,
      eventoId: "evt-2",
      tipo: "gesto_detectado",
      estado: "candidato",
    };
    const gestoConfirmado: EventoTemporal = {
      ...confirmado,
      eventoId: "evt-3",
      tipo: "gesto_detectado",
      estado: "confirmado",
    };
    const ctx = montar({
      eventosTemporais: [confirmado, movimentoObjeto, candidato, gestoConfirmado],
    });
    await ctx.controle.iniciar();

    // Fatos visuais confirmados vao para a fila; gesto fica no stream proprio.
    const agendados = ctx.tarefas.filter((t) => t.descricao.startsWith("evento:multiframe:"));
    expect(agendados).toHaveLength(2);
    await Promise.all(ctx.tarefas.map((t) => t.executar()));
    expect(ctx.eventosVisuais).toHaveLength(2);
    // timestamp = inicioEm (instante real), frameId = evidencia do ciclo,
    // id = identidade temporal (rastreavel de volta ao RegistroCiclo).
    expect(ctx.eventosVisuais[0]).toMatchObject({
      id: "evt-1",
      timestamp: "2026-10-19T02:00:19.500Z",
      tipo: "desaparecimento",
      origem: "rastreador",
      sessaoId: ctx.ciclos[0].sessionId,
      frameId: ctx.ciclos[0].frameIds[1],
    });
    expect(ctx.eventosVisuais).toContainEqual(
      expect.objectContaining({
        id: "evt-mov",
        tipo: "movimento",
        descricao: "caneca se desloca para a direita",
        origem: "rastreador",
        origensSinal: ["objetos"],
        rotuloObjeto: "bottle",
      })
    );
    expect(ctx.eventosVisuais[0].idempotencyKey).toBeTruthy();

    // A identidade que reaparece no proximo ciclo nao duplica no arquivo.
    await ctx.controle.executarCiclo();
    expect(ctx.tarefas.filter((t) => t.descricao.startsWith("evento:multiframe:"))).toHaveLength(2);
    ctx.controle.parar();
  });

  it("persiste gestos/posturas no stream temporal e ignora candidatos", async () => {
    const base: EventoTemporal = {
      eventoId: "evt-g1",
      sessionId: "s",
      tipo: "gesto_detectado",
      inicioEm: "2026-11-02T10:00:00.000Z",
      ultimaEvidenciaEm: "2026-11-02T10:00:01.000Z",
      ultimaObservacaoEm: "2026-11-02T10:00:01.200Z",
      entidadeId: "p1",
      descricao: "mao levantada",
      confianca: 0.9,
      origens: ["pose"],
      frameIds: ["f1", "f2"],
      estado: "confirmado",
    };
    const gestoConfirmado = base;
    const gestoCandidato: EventoTemporal = {
      ...base,
      eventoId: "evt-g2",
      estado: "candidato",
    };
    const bracoIncerto: EventoTemporal = {
      ...base,
      eventoId: "evt-g3",
      tipo: "braco_levantado",
      estado: "incerto",
      fimEm: "2026-11-02T10:00:01.000Z",
      intervaloSemObservacaoMs: 2500,
    };
    const movimentoEncerrado: EventoTemporal = {
      ...base,
      eventoId: "evt-g4",
      tipo: "movimento_corporal",
      estado: "encerrado",
      fimEm: "2026-11-02T10:00:02.000Z",
    };
    const transicaoEncerrada: EventoTemporal = {
      ...base,
      eventoId: "evt-g5",
      tipo: "transicao_acao",
      estado: "encerrado",
      fimEm: "2026-11-02T10:00:01.000Z",
      motivoEncerramento: "sem_sinal",
      continuidadeValida: false,
      evidencias: ["velocidadeY:-0.6/s"],
    };
    const ctx = montar({
      eventosTemporais: [
        gestoConfirmado,
        gestoCandidato,
        bracoIncerto,
        movimentoEncerrado,
        transicaoEncerrada,
      ],
    });
    await ctx.controle.iniciar();

    const agendados = () => ctx.tarefas.filter((t) => t.descricao.startsWith("memoria:"));
    // Confirmado, incerto e encerrado entram; candidato nunca vira memoria.
    expect(agendados()).toHaveLength(4);
    await Promise.all(ctx.tarefas.map((t) => t.executar()));
    expect(ctx.eventosTemporaisMemoria.map((e) => e.eventoId).sort()).toEqual([
      "evt-g1",
      "evt-g3",
      "evt-g4",
      "evt-g5",
    ]);
    // Os gestos nao poluem o stream de fatos visuais.
    expect(ctx.eventosVisuais).toHaveLength(0);

    const incerto = ctx.eventosTemporaisMemoria.find((e) => e.eventoId === "evt-g3");
    expect(incerto).toMatchObject({
      tipo: "braco_levantado",
      estado: "incerto",
      intervaloSemObservacaoMs: 2500,
      ultimaEvidenciaEm: "2026-11-02T10:00:01.000Z",
      ultimaObservacaoEm: "2026-11-02T10:00:01.200Z",
      entidadeId: "p1",
      frameIds: ["f1", "f2"],
      idempotencyKey: "evt-g3:incerto",
    });

    // Encerramento de transicao preserva motivo, continuidade e evidencias.
    const transicao = ctx.eventosTemporaisMemoria.find((e) => e.eventoId === "evt-g5");
    expect(transicao).toMatchObject({
      tipo: "transicao_acao",
      estado: "encerrado",
      motivoEncerramento: "sem_sinal",
      continuidadeValida: false,
      evidencias: ["velocidadeY:-0.6/s"],
    });

    // O mesmo estado nao duplica no proximo ciclo.
    await ctx.controle.executarCiclo();
    expect(agendados()).toHaveLength(4);

    // Reiniciar a sessao limpa a deduplicacao em memoria.
    ctx.controle.reiniciarSessao();
    await ctx.controle.executarCiclo();
    expect(agendados()).toHaveLength(8);
    ctx.controle.parar();
  });

});