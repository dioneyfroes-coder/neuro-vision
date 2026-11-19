import { describe, expect, it } from "vitest";
import { MaquinaSinais } from "../public/temporal/maquina-sinais";

// ---------------------------------------------------------------------------

describe("MaquinaSinais", () => {
  it("confirma apos N frames e encerra apos M frames sem sinal", () => {
    const m = new MaquinaSinais({ framesParaConfirmar: 2, framesParaEncerrar: 2 });
    const leitura = (rotulo: string | null, frame: number) => ({
      entidadeId: "e1",
      rotulo,
      confianca: 0.9,
      frameId: `f${frame}`,
      timestamp: `t${frame}`,
      cycleId: "c1",
    });

    expect(m.processar([leitura("gesto_a", 1)])).toHaveLength(0); // candidato
    const confirmados = m.processar([leitura("gesto_a", 2)]);
    expect(confirmados).toHaveLength(1);
    expect(confirmados[0].estado).toBe("confirmado");
    const eventoId = confirmados[0].eventoId;

    // Sinal ausente por 1 frame: ainda nao encerra.
    expect(m.processar([leitura(null, 3)])).toHaveLength(0);
    const encerrados = m.processar([leitura(null, 4)]);
    expect(encerrados).toHaveLength(1);
    expect(encerrados[0].estado).toBe("encerrado");
    expect(encerrados[0].eventoId).toBe(eventoId); // identidade estavel
    expect(encerrados[0].fimEm).toBeDefined();
  });

  it("diagnostico expoe o encerramento apenas no processamento em que ocorreu", () => {
    const m = new MaquinaSinais({ framesParaConfirmar: 2, framesParaEncerrar: 2 });
    const leitura = (rotulo: string | null, frame: number) => ({
      entidadeId: "e1",
      rotulo,
      confianca: 0.9,
      frameId: `f${frame}`,
      timestamp: `t${frame}`,
      cycleId: "c1",
    });

    m.processar([leitura("gesto_a", 1)]);
    m.processar([leitura("gesto_a", 2)]);
    m.processar([leitura(null, 3)]);
    // Antes de encerrar, o estado corrente e "ativo".
    const ativo = m.diagnosticos().find((d) => d.entidadeId === "e1");
    expect(ativo?.ativo).toBe(true);
    expect(ativo?.framesEvidencia).toBe(2);

    m.processar([leitura(null, 4)]); // encerra
    const encerrado = m.diagnosticos().find((d) => d.entidadeId === "e1");
    expect(encerrado?.ativo).toBe(false);
    expect(encerrado?.framesCandidato).toBe(0);
    expect(encerrado?.framesEvidencia).toBe(2);
    expect(encerrado?.motivoUltimaAusencia).toBe("sem_sinal");

    // O encerramento nao vira estado permanente: no proximo processamento, sem
    // novo ativo/candidato, nao ha diagnostico desse sinal.
    m.processar([leitura(null, 5)]);
    expect(m.diagnosticos().some((d) => d.entidadeId === "e1")).toBe(false);
  });

  it("fimEm e a ultima evidencia positiva, nunca o inicio nem o frame de ausencia", () => {
    const m = new MaquinaSinais({ framesParaConfirmar: 2, framesParaEncerrar: 2 });
    const leitura = (rotulo: string | null, frame: number) => ({
      entidadeId: "e1",
      rotulo,
      confianca: 0.9,
      frameId: `f${frame}`,
      timestamp: new Date(1700000000000 + frame * 100).toISOString(),
      cycleId: "c1",
    });

    m.processar([leitura("gesto_a", 1)]);
    m.processar([leitura("gesto_a", 2)]);
    // Duas evidencias positivas adicionais (frames 3 e 4).
    m.processar([leitura("gesto_a", 3)]);
    m.processar([leitura("gesto_a", 4)]);
    // Ausencia: a referencia de tempo do encerramento deve continuar no frame 4.
    m.processar([leitura(null, 5)]);
    const encerrados = m.processar([leitura(null, 6)]);
    expect(encerrados).toHaveLength(1);
    const evento = encerrados[0];
    const inicio = Date.parse(evento.inicioEm);
    const fim = Date.parse(evento.fimEm!);
    expect(fim).toBeGreaterThan(inicio); // nao colapsa para o inicio
    expect(evento.fimEm).toBe(leitura("gesto_a", 4).timestamp);
    expect(evento.motivoEncerramento).toBe("sem_sinal");
    // Evidencia positiva parou no frame 4; a entidade continuou sendo
    // observada (sem sinal) ate o frame 6, quando o evento encerrou.
    expect(evento.ultimaEvidenciaEm).toBe(leitura("gesto_a", 4).timestamp);
    expect(evento.ultimaObservacaoEm).toBe(leitura(null, 6).timestamp);
    expect(Date.parse(evento.ultimaObservacaoEm!)).toBeGreaterThan(
      Date.parse(evento.ultimaEvidenciaEm!)
    );
  });

  it("leitura sem sinal de entidade ainda no rastreador nao avanca a observacao", () => {
    const m = new MaquinaSinais({ framesParaConfirmar: 2, framesParaEncerrar: 2 });
    const leitura = (rotulo: string | null, frame: number, observada = true) => ({
      entidadeId: "e1",
      rotulo,
      confianca: rotulo === null ? 0 : 0.9,
      frameId: `f${frame}`,
      timestamp: new Date(1700000000000 + frame * 100).toISOString(),
      cycleId: "c1",
      observada,
    });

    m.processar([leitura("gesto_a", 1)]);
    m.processar([leitura("gesto_a", 2)]);
    m.processar([leitura("gesto_a", 3)]);
    // Frame 4: entidade nao foi vista, mas o rastreador ainda a mantem.
    expect(m.processar([leitura(null, 4, false)])).toHaveLength(0);
    const encerrados = m.processar([leitura(null, 5, false)]);
    expect(encerrados).toHaveLength(1);
    expect(encerrados[0].ultimaEvidenciaEm).toBe(leitura("gesto_a", 3).timestamp);
    // A observacao nao avancou para frames sem a entidade.
    expect(encerrados[0].ultimaObservacaoEm).toBe(leitura("gesto_a", 3).timestamp);
  });

  it("evento nunca termina antes de comecar (duracao nao negativa)", () => {
    const m = new MaquinaSinais({ framesParaConfirmar: 1, framesParaEncerrar: 1 });
    const leitura = (rotulo: string | null, frame: number) => ({
      entidadeId: "e1",
      rotulo,
      confianca: 0.9,
      frameId: `f${frame}`,
      timestamp: frame === 1 ? "2024-01-01T00:00:01.000Z" : "2024-01-01T00:00:00.000Z",
      cycleId: "c1",
    });
    const confirmados = m.processar([leitura("gesto_a", 1)]);
    expect(confirmados[0].estado).toBe("confirmado");
    // Frame seguinte com timestamp ANTERIOR (relogio fora de ordem).
    const encerrados = m.processar([leitura(null, 2)]);
    expect(encerrados).toHaveLength(1);
    expect(Date.parse(encerrados[0].fimEm!)).toBeGreaterThanOrEqual(
      Date.parse(encerrados[0].inicioEm)
    );
  });

  it("entidade desaparece do frame: fim usa a ultima evidencia, nao o inicio", () => {
    const m = new MaquinaSinais({ framesParaConfirmar: 2, framesParaEncerrar: 1 });
    const leitura = (frame: number) => ({
      entidadeId: "e1",
      rotulo: "gesto_a",
      confianca: 0.9,
      frameId: `f${frame}`,
      timestamp: new Date(1700000000000 + frame * 100).toISOString(),
      cycleId: "c1",
    });
    m.processar([leitura(1)]);
    m.processar([leitura(2)]);
    m.processar([leitura(3)]);
    // Proximo frame: sem leitura alguma para a entidade (sumiu do frame).
    const encerrados = m.processar([]);
    expect(encerrados).toHaveLength(1);
    expect(encerrados[0].fimEm).toBe(leitura(3).timestamp);
    expect(encerrados[0].ultimaEvidenciaEm).toBe(leitura(3).timestamp);
    // Sumiu do frame: a ultima observacao e a ultima vez que foi vista.
    expect(encerrados[0].ultimaObservacaoEm).toBe(leitura(3).timestamp);
    expect(Date.parse(encerrados[0].fimEm!)).toBeGreaterThan(Date.parse(encerrados[0].inicioEm));
  });

  it("inferencia indisponivel preserva ativo e reinicia candidatos", () => {
    const m = new MaquinaSinais({ framesParaConfirmar: 2, framesParaEncerrar: 2 });
    const leitura = (rotulo: string | null, frame: number) => ({
      entidadeId: "e1",
      rotulo,
      confianca: 0.9,
      frameId: `f${frame}`,
      timestamp: `t${frame}`,
      cycleId: "c1",
    });

    // Candidato de 1 frame, depois falha de inferencia: candidato reinicia.
    m.processar([leitura("gesto_a", 1)]);
    expect(m.processar([], { indisponivel: true })).toHaveLength(0);
    // Um unico frame valido nao confirma (candidato foi descartado).
    expect(m.processar([leitura("gesto_a", 2)])).toHaveLength(0);
    const confirmados = m.processar([leitura("gesto_a", 3)]);
    expect(confirmados).toHaveLength(1);
    expect(confirmados[0].estado).toBe("confirmado");

    // Com o evento ativo, uma falha de inferencia NAO encerra.
    expect(m.processar([], { indisponivel: true })).toHaveLength(0);
    expect(m.estaAtivo("e1")).toBe(true);
    // Recuperacao: sinal volta a ser observado, evento continua o mesmo.
    expect(m.processar([leitura("gesto_a", 4)])).toHaveLength(0);
    expect(m.estaAtivo("e1")).toBe(true);
  });

  it("troca de sinal so encerra o ativo quando o novo sinal e confirmado", () => {
    const m = new MaquinaSinais({ framesParaConfirmar: 2, framesParaEncerrar: 2 });
    const leitura = (rotulo: string, frame: number) => ({
      entidadeId: "e1",
      rotulo,
      confianca: 0.9,
      frameId: `f${frame}`,
      timestamp: new Date(1700000000000 + frame * 100).toISOString(),
      cycleId: "c1",
    });

    m.processar([leitura("gesto_a", 1)]);
    const confirmados = m.processar([leitura("gesto_a", 2)]);
    expect(confirmados).toHaveLength(1);
    const idA = confirmados[0].eventoId;

    // Um unico frame com outro rotulo nao encerra o ativo: o substituto ainda
    // nao foi observado o bastante para afirmar uma transicao.
    expect(m.processar([leitura("gesto_b", 3)])).toHaveLength(0);
    expect(m.estaAtivo("e1")).toBe(true);
    const diag = m.diagnosticos().find((d) => d.entidadeId === "e1");
    expect(diag?.rotuloAtivo).toBe("gesto_a");
    expect(diag?.rotuloCandidato).toBe("gesto_b");
    expect(diag?.framesCandidato).toBe(1);

    // Segundo frame de B: a troca e observada e o ativo encerra por troca_sinal.
    const eventos = m.processar([leitura("gesto_b", 4)]);
    const encerrado = eventos.find((e) => e.estado === "encerrado");
    const novo = eventos.find((e) => e.estado === "confirmado");
    expect(encerrado?.eventoId).toBe(idA);
    expect(encerrado?.motivoEncerramento).toBe("troca_sinal");
    expect(encerrado?.fimEm).toBe(leitura("gesto_a", 2).timestamp);
    expect(novo?.eventoId).not.toBe(idA);
    expect(novo?.rotulo).toBe("gesto_b");
    // O novo evento comeca no primeiro frame do candidato, nao na confirmacao.
    expect(novo?.inicioEm).toBe(leitura("gesto_b", 3).timestamp);
  });

  it("rotulo instavel nao trunca o evento ativo", () => {
    const m = new MaquinaSinais({ framesParaConfirmar: 2, framesParaEncerrar: 2 });
    const leitura = (rotulo: string, frame: number) => ({
      entidadeId: "e1",
      rotulo,
      confianca: 0.9,
      frameId: `f${frame}`,
      timestamp: `t${frame}`,
      cycleId: "c1",
    });

    m.processar([leitura("gesto_a", 1)]);
    const confirmados = m.processar([leitura("gesto_a", 2)]);
    const idA = confirmados[0].eventoId;

    // Flicker de um frame e volta ao sinal original: nada e emitido e o mesmo
    // evento continua, com a evidencia do frame 3 preservada.
    expect(m.processar([leitura("gesto_b", 3)])).toHaveLength(0);
    expect(m.processar([leitura("gesto_a", 4)])).toHaveLength(0);
    expect(m.estaAtivo("e1")).toBe(true);
    expect(m.ativos()[0].eventoId).toBe(idA);
    expect(m.ativos()[0].framesSinal).toBe(3);
  });

  it("interromperPorPeriodoCego encerra na ultima evidencia com motivo e lacuna", () => {
    const m = new MaquinaSinais({ framesParaConfirmar: 2, framesParaEncerrar: 2 });
    const leitura = (frame: number) => ({
      entidadeId: "e1",
      rotulo: "gesto_a",
      confianca: 0.9,
      frameId: `f${frame}`,
      timestamp: new Date(1700000000000 + frame * 100).toISOString(),
      cycleId: "c1",
    });
    // Entidade desconhecida nao esta ativa.
    expect(m.estaAtivo("inexistente")).toBe(false);

    m.processar([leitura(1)]);
    m.processar([leitura(2)]);
    m.processar([leitura(3)]);

    const interrompidos = m.interromperPorPeriodoCego(4000);
    expect(interrompidos).toHaveLength(1);
    expect(interrompidos[0].estado).toBe("encerrado");
    expect(interrompidos[0].motivoEncerramento).toBe("periodo_cego");
    expect(interrompidos[0].intervaloSemObservacaoMs).toBe(4000);
    expect(interrompidos[0].fimEm).toBe(leitura(3).timestamp);
    expect(m.estaAtivo("e1")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Sequencias sinteticas do motor
