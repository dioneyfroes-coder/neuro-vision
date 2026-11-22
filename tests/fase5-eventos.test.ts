import { describe, expect, it } from "vitest";
import {
  ACOES_EVENTO,
  DESCRITOR_ESQUEMA_EVENTO,
  VERSAO_ESQUEMA_EVENTO,
  aplicarCorrecaoEvento,
  eventoCorrespondeAacao,
  filtrarEventosTemporais,
  registroDeEventoTemporal,
  serializarEventos,
  validarPedidoCorrecao,
  type EventoFiltravel,
} from "../src/domain";

const EVENTO: EventoFiltravel = {
  eventoId: "e1",
  sessionId: "s1",
  tipo: "interacao_objeto",
  estado: "confirmado",
  inicioEm: "2026-11-22T10:00:00.000Z",
  fimEm: "2026-11-22T10:00:04.000Z",
  descricao: "mão e garrafa",
  rotuloObjeto: "garrafa",
  entidadeId: "obj-1",
  participantes: ["mao-1", "obj-1"],
  pessoaEntidadeId: "pessoa-1",
  naturezaInteracao: "manipulacao",
  transicaoPosse: "pego",
};

describe("schema canônico (Fase 5)", () => {
  it("publica versão e vocabulário únicos", () => {
    expect(VERSAO_ESQUEMA_EVENTO).toBe(1);
    expect(DESCRITOR_ESQUEMA_EVENTO.contratoCanonico).toBe("EventoTemporal");
    expect(ACOES_EVENTO).toContain("manipulacao");
    expect(ACOES_EVENTO).toContain("interacao_objeto");
  });

  it("ação casa com natureza/posse quando medida, senão com o tipo", () => {
    expect(eventoCorrespondeAacao(EVENTO, ["manipulacao"])).toBe(true);
    expect(eventoCorrespondeAacao(EVENTO, ["pego"])).toBe(true);
    expect(eventoCorrespondeAacao(EVENTO, ["interacao_objeto"])).toBe(true);
    expect(eventoCorrespondeAacao(EVENTO, ["contato"])).toBe(false);
    expect(eventoCorrespondeAacao(EVENTO, [])).toBe(true);
    const semNatureza = { tipo: "interacao_objeto" };
    expect(eventoCorrespondeAacao(semNatureza, ["contato"])).toBe(false);
    expect(eventoCorrespondeAacao(semNatureza, ["interacao_objeto"])).toBe(true);
  });
});

describe("filtrarEventosTemporais", () => {
  it("combina horário, pessoa, objeto, participante, entidade e ação", () => {
    const outro: EventoFiltravel = {
      ...EVENTO,
      eventoId: "e2",
      sessionId: "s2",
      inicioEm: "2026-11-22T11:00:00.000Z",
      fimEm: "2026-11-22T11:00:01.000Z",
      rotuloObjeto: "copo",
      pessoaEntidadeId: "pessoa-2",
      participantes: ["mao-2"],
      naturezaInteracao: "proximidade",
      transicaoPosse: undefined,
    };
    const base = [EVENTO, outro];
    expect(filtrarEventosTemporais(base, { sessionId: "s1" })).toEqual([EVENTO]);
    expect(filtrarEventosTemporais(base, { pessoaEntidadeId: "pessoa-2" })).toEqual([outro]);
    expect(filtrarEventosTemporais(base, { objetos: ["copo"] })).toEqual([outro]);
    expect(filtrarEventosTemporais(base, { participantes: ["mao-1"] })).toEqual([EVENTO]);
    expect(filtrarEventosTemporais(base, { entidadeId: "inexistente" })).toEqual([]);
    expect(filtrarEventosTemporais(base, { acoes: ["pego"] })).toEqual([EVENTO]);
    expect(filtrarEventosTemporais(base, { acoes: ["proximidade"] })).toEqual([outro]);
    expect(
      filtrarEventosTemporais(base, {
        desdeMs: Date.parse("2026-11-22T10:59:00.000Z"),
        acoes: ["interacao_objeto"],
      })
    ).toEqual([outro]);
  });

  it("usa sobreposição: evento iniciado antes da janela e ainda ativo continua", () => {
    const desdeMs = Date.parse("2026-11-22T10:00:02.000Z");
    const ateMs = Date.parse("2026-11-22T10:00:03.000Z");
    expect(filtrarEventosTemporais([EVENTO], { desdeMs, ateMs })).toEqual([EVENTO]);
    expect(
      filtrarEventosTemporais([EVENTO], { desdeMs: Date.parse("2026-11-22T10:00:05.000Z") })
    ).toEqual([]);
    expect(
      filtrarEventosTemporais([EVENTO], { ateMs: Date.parse("2026-11-22T09:59:59.000Z") })
    ).toEqual([]);
  });

  it("não filtra por janela quando o instante é inválido", () => {
    const invalido = { ...EVENTO, inicioEm: "não-data" };
    expect(
      filtrarEventosTemporais([invalido], { desdeMs: Date.parse("2030-01-01T00:00:00Z") })
    ).toEqual([invalido]);
  });
});

describe("exportação de eventos", () => {
  const registro = registroDeEventoTemporal({
    ...EVENTO,
    statusEvidencia: "inferido",
    confianca: 0.75,
    schemaVersion: VERSAO_ESQUEMA_EVENTO,
  });
  const metadados = {
    geradoEm: "2026-11-22T12:00:00.000Z",
    versaoEsquema: VERSAO_ESQUEMA_EVENTO,
    sessaoId: "s1",
    filtros: { acao: "pego" },
  };

  it("emite JSONL com cabeçalho de metadados e um registro por evento", () => {
    const linhas = serializarEventos([registro], "jsonl", metadados).trim().split("\n").map((l) => JSON.parse(l));
    expect(linhas[0]).toMatchObject({
      registro: "metadados",
      versao: 1,
      geradoEm: metadados.geradoEm,
      sessaoId: "s1",
      total: 1,
      filtros: { acao: "pego" },
    });
    expect(linhas[1]).toMatchObject({
      registro: "evento",
      tipo: "interacao_objeto",
      naturezaInteracao: "manipulacao",
      transicaoPosse: "pego",
      pessoaEntidadeId: "pessoa-1",
    });
    expect(linhas[1].corrigidoPor).toBeUndefined();
  });

  it("emite CSV com metadados por linha e escapa vírgulas/aspas", () => {
    const comVirgula = { ...registro, descricao: 'mão, "garrafa"\nlinha' };
    const csv = serializarEventos([comVirgula], "csv", metadados);
    const linhas = csv.trim().split("\r\n");
    expect(linhas[0]).toContain("versaoEsquema,geradoEm");
    expect(csv).toContain('"mão, ""garrafa""\nlinha"');
    expect(linhas[1]).toContain("2026-11-22T12:00:00.000Z");
  });
});

describe("correção humana auditável", () => {
  const evento = {
    ...EVENTO,
    statusEvidencia: "observado" as const,
    schemaVersion: VERSAO_ESQUEMA_EVENTO,
  };

  it("aceita somente autor, motivo e campos conhecidos", () => {
    expect(
      validarPedidoCorrecao({
        eventoId: "e1",
        corrigidoPor: "ana",
        motivo: "rótulo errado",
        alteracoes: { rotuloObjeto: "garrafa térmica", transicaoPosse: "deixado" },
      })
    ).toMatchObject({ eventoId: "e1", alteracoes: { rotuloObjeto: "garrafa térmica" } });
    expect(
      validarPedidoCorrecao({
        eventoId: "e1",
        corrigidoPor: "ana",
        motivo: "x",
        alteracoes: { statusEvidencia: "observado" },
      })
    ).toBeNull();
    expect(
      validarPedidoCorrecao({
        eventoId: "e1",
        corrigidoPor: "ana",
        motivo: "x",
        alteracoes: { naturezaInteracao: "voou" },
      })
    ).toBeNull();
    expect(
      validarPedidoCorrecao({ eventoId: "e1", corrigidoPor: "", motivo: "x", alteracoes: {} })
    ).toBeNull();
  });

  it("guarda valor original, incrementa versão e não altera evidência nem tempo", () => {
    const pedido = validarPedidoCorrecao({
      eventoId: "e1",
      corrigidoPor: "ana",
      motivo: "rótulo errado",
      alteracoes: { rotuloObjeto: "garrafa térmica", pessoaEntidadeId: null },
    })!;
    const corrigido = aplicarCorrecaoEvento(evento, pedido, "2026-11-22T12:34:56.000Z");
    expect(corrigido).toMatchObject({
      rotuloObjeto: "garrafa térmica",
      pessoaEntidadeId: undefined,
      statusEvidencia: "observado",
      estado: "confirmado",
      inicioEm: evento.inicioEm,
      correcao: {
        versao: 1,
        corrigidoPor: "ana",
        corrigidoEm: "2026-11-22T12:34:56.000Z",
        valorOriginal: { rotuloObjeto: "garrafa", pessoaEntidadeId: "pessoa-1" },
      },
    });
    expect(evento.rotuloObjeto).toBe("garrafa");
    const segunda = aplicarCorrecaoEvento(corrigido, pedido, "2026-11-22T12:35:00.000Z");
    expect(segunda.correcao?.versao).toBe(2);
  });
});
