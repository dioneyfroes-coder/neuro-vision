import { describe, expect, it } from "vitest";
import { indisponivel } from "../src/domain";
import type { ObservacaoFrame } from "../src/domain";
import { criarMotor, maoComGesto, maoGeometrica, maoIndicadorCurvo, obs, reiniciarContador } from "./helpers/motor-temporal";

describe("MotorTemporalImpl — gestos", () => {
  it("mão aberta mantida confirma gesto_detectado", () => {
    reiniciarContador();
    const motor = criarMotor();
    const eventos = [];
    for (let i = 0; i < 3; i += 1) {
      const r = motor.processar([obs({ ms: i * 100, maos: maoComGesto("mao_aberta") })]);
      eventos.push(...r.eventos.filter((e) => e.tipo === "gesto_detectado"));
    }
    const confirmado = eventos.find((e) => e.estado === "confirmado");
    expect(confirmado).toBeDefined();
    expect(confirmado?.descricao).toContain("mao_aberta");
    expect(confirmado?.origens).toEqual(["maos"]);
  });

  it("polegar para cima mantido confirma gesto_detectado", () => {
    reiniciarContador();
    const motor = criarMotor();
    const eventos = [];
    for (let i = 0; i < 3; i += 1) {
      const r = motor.processar([obs({ ms: i * 100, maos: maoComGesto("polegar_para_cima") })]);
      eventos.push(...r.eventos.filter((e) => e.tipo === "gesto_detectado"));
    }
    const confirmado = eventos.find((e) => e.estado === "confirmado");
    expect(confirmado?.descricao).toContain("polegar_para_cima");
  });

  it("gesto instável (1 frame) não confirma", () => {
    reiniciarContador();
    const motor = criarMotor();
    const r1 = motor.processar([obs({ ms: 0, maos: maoComGesto("mao_aberta") })]);
    expect(r1.eventos.filter((e) => e.tipo === "gesto_detectado")).toHaveLength(0);
    // Some no frame seguinte.
    const r2 = motor.processar([obs({ ms: 100, maos: { maos: [] } })]);
    const r3 = motor.processar([obs({ ms: 200, maos: { maos: [] } })]);
    const todos = [...r1.eventos, ...r2.eventos, ...r3.eventos];
    expect(todos.filter((e) => e.estado === "confirmado")).toHaveLength(0);
  });

  it("geometria sem rotulo do modelo reconhece mao aberta", () => {
    reiniciarContador();
    const motor = criarMotor();
    const eventos = [];
    for (let i = 0; i < 3; i += 1) {
      const r = motor.processar([obs({ ms: i * 100, maos: { maos: [maoGeometrica()] } })]);
      eventos.push(...r.eventos.filter((e) => e.tipo === "gesto_detectado"));
    }
    const confirmado = eventos.find((e) => e.estado === "confirmado");
    expect(confirmado).toBeDefined();
    expect(confirmado?.descricao).toContain("mao_aberta");
    // A origem continua sendo maos; a evidencia concreta fica registrada.
    expect(confirmado?.origens).toEqual(["maos"]);
    expect(confirmado?.evidencias?.some((e) => e.startsWith("geometria:"))).toBe(true);
    expect(confirmado?.confianca).toBeLessThanOrEqual(0.9);
  });

  it("usa as dimensoes do frame para corrigir a geometria do gesto", () => {
    // Sem dimensoes, o indicador parece dobrado e a mao fica com 4 dedos
    // estendidos: a regra nao fecha "mao_aberta".
    reiniciarContador();
    const semDimensoes = criarMotor();
    let confirmadoSem: unknown;
    for (let i = 0; i < 3; i += 1) {
      const r = semDimensoes.processar([
        obs({ ms: i * 100, maos: { maos: [maoIndicadorCurvo()] } }),
      ]);
      confirmadoSem ??= r.eventos.find(
        (e) => e.tipo === "gesto_detectado" && e.estado === "confirmado"
      );
    }
    expect(confirmadoSem).toBeUndefined();

    // Com as dimensoes reais (16:9), o angulo e corrigido e os cinco dedos
    // contam como estendidos.
    reiniciarContador();
    const comDimensoes = criarMotor();
    const eventos = [];
    for (let i = 0; i < 3; i += 1) {
      const r = comDimensoes.processar([
        obs({
          ms: i * 100,
          maos: {
            maos: [maoIndicadorCurvo()],
            dimensoes: { largura: 1600, altura: 900 },
          },
        }),
      ]);
      eventos.push(...r.eventos.filter((e) => e.tipo === "gesto_detectado"));
    }
    const confirmado = eventos.find((e) => e.estado === "confirmado");
    expect(confirmado?.descricao).toContain("mao_aberta");
  });

  it("mão ocultada encerra o gesto por oclusao, nao por 'sem sinal'", () => {
    reiniciarContador();
    const motor = criarMotor();
    motor.processar([obs({ ms: 0, maos: maoComGesto("mao_aberta") })]);
    const r2 = motor.processar([obs({ ms: 100, maos: maoComGesto("mao_aberta") })]);
    const confirmado = r2.eventos.find((e) => e.tipo === "gesto_detectado" && e.estado === "confirmado");
    expect(confirmado).toBeDefined();

    // Mao oculta por 2 frames (>= framesParaEncerrar).
    const r3 = motor.processar([obs({ ms: 200, maos: { maos: [] } })]);
    expect(
      r3.diagnosticos?.some(
        (d) => d.sinal === "gesto" && d.estado === "ocluido"
      )
    ).toBe(true);
    const r4 = motor.processar([obs({ ms: 300, maos: { maos: [] } })]);
    const encerrado = r4.eventos.find((e) => e.tipo === "gesto_detectado" && e.estado === "encerrado");
    expect(encerrado).toBeDefined();
    expect(encerrado?.eventoId).toBe(confirmado?.eventoId);
    expect(encerrado?.fimEm).toBeDefined();
    expect(encerrado?.motivoEncerramento).toBe("oclusao");
    // A continuidade ate a ultima evidencia era valida; a oclusao explica o fim.
    expect(encerrado?.continuidadeValida).toBe(true);
    // O diagnostico do ciclo distingue o encerramento do estado "ocluido".
    const diagEncerrado = r4.diagnosticos?.find((d) => d.sinal === "gesto");
    expect(diagEncerrado?.estado).toBe("encerrado");
    expect(diagEncerrado?.motivoEncerramento).toBe("oclusao");
    // duracao = fim - inicio (300 - 0 = 300ms apos normalizar epoch).
    const dur = Date.parse(encerrado!.fimEm!) - Date.parse(encerrado!.inicioEm);
    expect(dur).toBeGreaterThanOrEqual(0);
  });

  it("mao visivel sem gesto encerra como 'sem sinal'", () => {
    reiniciarContador();
    const motor = criarMotor();
    motor.processar([obs({ ms: 0, maos: maoComGesto("mao_aberta") })]);
    const r2 = motor.processar([obs({ ms: 100, maos: maoComGesto("mao_aberta") })]);
    expect(
      r2.eventos.some((e) => e.tipo === "gesto_detectado" && e.estado === "confirmado")
    ).toBe(true);

    const semGesto: ObservacaoFrame["maos"] = {
      maos: [{ lateralidade: "direita", landmarks: [{ x: 0.5, y: 0.4 }] }],
    };
    motor.processar([obs({ ms: 200, maos: semGesto })]);
    const r4 = motor.processar([obs({ ms: 300, maos: semGesto })]);
    const encerrado = r4.eventos.find(
      (e) => e.tipo === "gesto_detectado" && e.estado === "encerrado"
    );
    expect(encerrado?.motivoEncerramento).toBe("sem_sinal");
    expect(encerrado?.ultimaObservacaoEm).toBe(
      new Date(1700000000000 + 300).toISOString()
    );
  });

  it("observacao insuficiente nao confirma e aparece no diagnostico", () => {
    reiniciarContador();
    const motor = criarMotor();
    const r = motor.processar([obs({ ms: 0, maos: maoComGesto("mao_aberta") })]);
    expect(
      r.eventos.some((e) => e.tipo === "gesto_detectado" && e.estado === "confirmado")
    ).toBe(false);
    const diag = r.diagnosticos?.find((d) => d.sinal === "gesto");
    expect(diag?.estado).toBe("observacao_insuficiente");
    expect(diag?.framesEvidencia).toBe(1);
  });

  it("inferencia indisponivel preserva o gesto e aparece no diagnostico", () => {
    reiniciarContador();
    const motor = criarMotor();
    motor.processar([obs({ ms: 0, maos: maoComGesto("mao_aberta") })]);
    motor.processar([obs({ ms: 100, maos: maoComGesto("mao_aberta") })]);
    const r = motor.processar([
      obs({ ms: 200, maos: indisponivel("maos", "timeout") }),
    ]);
    expect(r.eventos.some((e) => e.tipo === "gesto_detectado" && e.estado === "encerrado")).toBe(
      false
    );
    const diag = r.diagnosticos?.find((d) => d.sinal === "gesto");
    expect(diag?.estado).toBe("inferencia_indisponivel");
  });

  it("troca de gesto confirmada nao duplica eventos e preserva a evidencia", () => {
    reiniciarContador();
    const motor = criarMotor();
    motor.processar([obs({ ms: 0, maos: maoComGesto("mao_aberta") })]);
    const r2 = motor.processar([obs({ ms: 100, maos: maoComGesto("mao_aberta") })]);
    const confA = r2.eventos.find(
      (e) => e.tipo === "gesto_detectado" && e.estado === "confirmado"
    );
    expect(confA).toBeDefined();

    // Primeiro frame do novo gesto: candidato, sem encerrar o ativo.
    const r3 = motor.processar([obs({ ms: 200, maos: maoComGesto("punho_fechado") })]);
    expect(r3.eventos.filter((e) => e.tipo === "gesto_detectado")).toHaveLength(0);

    // Segundo frame: a troca se sustenta e vira um par encerrado/confirmado.
    const r4 = motor.processar([obs({ ms: 300, maos: maoComGesto("punho_fechado") })]);
    const eventos = r4.eventos.filter((e) => e.tipo === "gesto_detectado");
    const encerrado = eventos.find((e) => e.estado === "encerrado");
    const confB = eventos.find((e) => e.estado === "confirmado");
    expect(encerrado?.eventoId).toBe(confA?.eventoId);
    expect(encerrado?.motivoEncerramento).toBe("troca_sinal");
    expect(encerrado?.fimEm).toBe(new Date(1700000000000 + 100).toISOString());
    expect(confB?.descricao).toContain("punho_fechado");
    expect(confB?.eventoId).not.toBe(confA?.eventoId);
    // O novo evento comeca na primeira evidencia, nao na confirmacao.
    expect(confB?.inicioEm).toBe(new Date(1700000000000 + 200).toISOString());
    // A mao continua sendo o mesmo track: a troca e de gesto, nao de entidade.
    expect(confB?.entidadeId).toBe(confA?.entidadeId);
  });

  it("oclusao curta nao encerra nem duplica o gesto ativo", () => {
    reiniciarContador();
    const motor = criarMotor();
    motor.processar([obs({ ms: 0, maos: maoComGesto("mao_aberta") })]);
    const r2 = motor.processar([obs({ ms: 100, maos: maoComGesto("mao_aberta") })]);
    const confirmado = r2.eventos.find(
      (e) => e.tipo === "gesto_detectado" && e.estado === "confirmado"
    );
    const idMao = confirmado?.entidadeId;
    expect(idMao).toBeDefined();

    // Mao oculta por um frame (abaixo de `framesParaEncerrar`).
    const r3 = motor.processar([obs({ ms: 200, maos: { maos: [] } })]);
    expect(r3.eventos.filter((e) => e.tipo === "gesto_detectado")).toHaveLength(0);
    expect(r3.diagnosticos?.some((d) => d.sinal === "gesto" && d.estado === "ocluido")).toBe(true);

    // Recuperacao: mesmo track, mesmo evento, sem re-confirmar.
    const r4 = motor.processar([obs({ ms: 300, maos: maoComGesto("mao_aberta") })]);
    expect(r4.eventos.filter((e) => e.tipo === "gesto_detectado")).toHaveLength(0);
    expect(motor.maosVivas[0].entidadeId).toBe(idMao);
    expect(r4.diagnosticos?.some((d) => d.sinal === "gesto" && d.estado === "confirmado")).toBe(
      true
    );
  });

  it("movimento rapido entre snapshots nao herda o track nem confirma em 1 frame", () => {
    reiniciarContador();
    const motor = criarMotor();
    motor.processar([obs({ ms: 0, maos: maoComGesto("mao_aberta", 0.9, 0.2) })]);
    const r2 = motor.processar([obs({ ms: 100, maos: maoComGesto("mao_aberta", 0.9, 0.2) })]);
    const confAntigo = r2.eventos.find(
      (e) => e.tipo === "gesto_detectado" && e.estado === "confirmado"
    );
    expect(confAntigo).toBeDefined();

    // Salto de 0.7 > `distanciaMaxima` (0.3): e outro track, nao o mesmo.
    const r3 = motor.processar([obs({ ms: 200, maos: maoComGesto("mao_aberta", 0.9, 0.9) })]);
    expect(r3.eventos.filter((e) => e.tipo === "gesto_detectado")).toHaveLength(0);

    const r4 = motor.processar([obs({ ms: 300, maos: maoComGesto("mao_aberta", 0.9, 0.9) })]);
    const eventos = r4.eventos.filter((e) => e.tipo === "gesto_detectado");
    const encerrado = eventos.find((e) => e.estado === "encerrado");
    const confNovo = eventos.find((e) => e.estado === "confirmado");
    // O track antigo sai por oclusao (nao foi visto), na ultima evidencia.
    expect(encerrado?.eventoId).toBe(confAntigo?.eventoId);
    expect(encerrado?.motivoEncerramento).toBe("oclusao");
    expect(encerrado?.fimEm).toBe(new Date(1700000000000 + 100).toISOString());
    // O novo track so confirma depois de 2 frames e tem outro ID.
    expect(confNovo).toBeDefined();
    expect(confNovo?.entidadeId).not.toBe(confAntigo?.entidadeId);
    expect(confNovo?.inicioEm).toBe(new Date(1700000000000 + 200).toISOString());
  });

  it("queda de confianca (iluminacao) nao encerra nem confirma antes da janela", () => {
    reiniciarContador();
    const motor = criarMotor();
    motor.processar([obs({ ms: 0, maos: maoComGesto("mao_aberta", 0.9) })]);
    const r2 = motor.processar([obs({ ms: 100, maos: maoComGesto("mao_aberta", 0.9) })]);
    expect(
      r2.eventos.some((e) => e.tipo === "gesto_detectado" && e.estado === "confirmado")
    ).toBe(true);

    // Confianca abaixo do limiar: sinal deixa de ser valido, mas o evento nao
    // encerra no primeiro frame (histerese de `framesParaEncerrar`).
    const r3 = motor.processar([obs({ ms: 200, maos: maoComGesto("mao_aberta", 0.2) })]);
    expect(r3.eventos.filter((e) => e.tipo === "gesto_detectado")).toHaveLength(0);

    const r4 = motor.processar([obs({ ms: 300, maos: maoComGesto("mao_aberta", 0.2) })]);
    const encerrado = r4.eventos.find(
      (e) => e.tipo === "gesto_detectado" && e.estado === "encerrado"
    );
    expect(encerrado?.motivoEncerramento).toBe("sem_sinal");
    expect(encerrado?.fimEm).toBe(new Date(1700000000000 + 100).toISOString());

    // Sem evento ativo, confianca baixa nunca confirma.
    reiniciarContador();
    const outro = criarMotor();
    for (let i = 0; i < 3; i += 1) {
      const r = outro.processar([obs({ ms: i * 100, maos: maoComGesto("mao_aberta", 0.2) })]);
      expect(r.eventos.filter((e) => e.tipo === "gesto_detectado")).toHaveLength(0);
    }
  });

  it("mudanca brusca de iluminacao nao interrompe gesto ativo", () => {
    reiniciarContador();
    const motor = criarMotor();
    const escuro = Array(9).fill(0);
    const claro = Array(9).fill(255);
    motor.processar([obs({ ms: 0, maos: maoComGesto("mao_aberta"), assinaturaCena: escuro })]);
    motor.processar([obs({ ms: 100, maos: maoComGesto("mao_aberta"), assinaturaCena: escuro })]);
    const r = motor.processar([
      obs({ ms: 200, maos: maoComGesto("mao_aberta"), assinaturaCena: claro }),
    ]);
    // A cena muda, mas a mao continua observada: o gesto nao e interrompido.
    expect(r.eventos.some((e) => e.tipo === "mudanca_de_cena")).toBe(true);
    expect(r.eventos.filter((e) => e.tipo === "gesto_detectado")).toHaveLength(0);
    expect(r.diagnosticos?.some((d) => d.sinal === "gesto" && d.estado === "confirmado")).toBe(
      true
    );
  });
});

// ---------------------------------------------------------------------------
// Reuso de estado, periodo cego, reset
// ---------------------------------------------------------------------------
