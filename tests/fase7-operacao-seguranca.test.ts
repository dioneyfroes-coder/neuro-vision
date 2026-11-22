import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type http from "node:http";
import {
  ArmazenadorVideos,
  aplicarRecuperacaoMonitoramento,
  autenticarRequisicao,
  criarCookieSessao,
  criarRegistroAuditoria,
  criarCifradorVideo,
  identificadorAtor,
  interpretarChaveVideo,
  lerAuditoria,
  planejarRecuperacaoMonitoramento,
  politicaAutenticacao,
  gravarAuditoria,
  gravarSessaoMonitoramento,
  gravarSegmentoMonitoramento,
  lerSessoesMonitoramento,
  lerSegmentosMonitoramento,
  selecionarParaRetencao,
  validarCookieSessao,
  createServer as criarServer,
} from "../src/server";
import type { SessaoMonitoramento, VideoSegment } from "../src/domain";

const BASE = 1_700_000_000_000;
const TOKEN = "token-de-teste-fase-7";

let tmpDir: string;
const servidores: http.Server[] = [];

function segmento(sobres: Partial<VideoSegment> = {}): VideoSegment {
  return {
    segmentoId: "seg-1",
    sessaoId: "sessao-1",
    sequencia: 1,
    inicioEm: new Date(BASE).toISOString(),
    inicioMs: BASE,
    fimEm: new Date(BASE + 1_000).toISOString(),
    fimMs: BASE + 1_000,
    duracaoMs: 1_000,
    quadros: 5,
    estado: "fechado",
    motivoFim: "duracao",
    lacunas: [],
    ...sobres,
  };
}

function sessao(sobres: Partial<SessaoMonitoramento> = {}): SessaoMonitoramento {
  return {
    sessaoId: "sessao-1",
    ambiente: "sala",
    iniciadaEm: new Date(BASE).toISOString(),
    iniciadaEmMs: BASE,
    estado: "ativa",
    duracaoSegmentoMs: 300_000,
    retencaoPreEventoMs: 10_000,
    limiarLacunaMs: 2_000,
    ...sobres,
  };
}

const upload = (bytes: Uint8Array) => ({
  bytes,
  contentType: "video/webm",
  criadoEmMs: BASE,
});

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "neuro-fase7-"));
});

afterEach(async () => {
  await Promise.all(
    servidores.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve()))
    )
  );
  await rm(tmpDir, { recursive: true, force: true });
});

describe("Fase 7 — auditoria append-only", () => {
  it("cria registro com id/timestamp injetados e remove detalhes sensíveis", () => {
    const registro = criarRegistroAuditoria(
      {
        acao: "acesso_video",
        resultado: "sucesso",
        ator: "token:abc",
        alvo: "seg-1",
        detalhe: {
          token: "segredo",
          senha: "x",
          authorization: "Bearer y",
          cookie: "z",
          total: 3,
          cifrado: false,
        },
      },
      new Date(BASE),
      "reg-1"
    );
    expect(registro).toEqual({
      schemaVersion: 1,
      registroId: "reg-1",
      timestamp: new Date(BASE).toISOString(),
      acao: "acesso_video",
      resultado: "sucesso",
      ator: "token:abc",
      alvo: "seg-1",
      detalhe: { total: 3, cifrado: false },
    });
    expect(JSON.stringify(registro)).not.toContain("segredo");
  });

  it("persiste e lê a trilha sem confundi-la com eventos visuais", async () => {
    const arquivo = path.join(tmpDir, "auditoria.jsonl");
    await gravarAuditoria(
      criarRegistroAuditoria(
        { acao: "exportacao_eventos", resultado: "sucesso", ator: "anonimo" },
        new Date(BASE),
        "r1"
      ),
      arquivo,
      1_000_000
    );
    const lidos = await lerAuditoria(arquivo, 10);
    expect(lidos).toHaveLength(1);
    expect(lidos[0]).toMatchObject({ registroId: "r1", acao: "exportacao_eventos" });
  });
});

describe("Fase 7 — retenção por idade, quantidade e espaço", () => {
  const arquivos = [
    { segmentoId: "a", criadoEmMs: BASE, bytes: 100 },
    { segmentoId: "b", criadoEmMs: BASE + 1_000, bytes: 100 },
    { segmentoId: "c", criadoEmMs: BASE + 2_000, bytes: 100 },
  ];

  it("seleciona por idade sem tocar em arquivos dentro da janela", () => {
    const resultado = selecionarParaRetencao(
      arquivos,
      { maxIdadeMs: 1_500, maxArquivos: 0, maxBytesTotais: 0 },
      BASE + 3_000
    );
    expect(resultado.remover.map((alvo) => alvo.segmentoId)).toEqual(["a", "b"]);
    expect(resultado.motivos).toEqual({ a: ["idade"], b: ["idade"] });
  });

  it("seleciona os mais antigos por quantidade e espaço", () => {
    const quantidade = selecionarParaRetencao(
      arquivos,
      { maxIdadeMs: 0, maxArquivos: 2, maxBytesTotais: 0 },
      BASE + 3_000
    );
    expect(quantidade.remover.map((alvo) => alvo.segmentoId)).toEqual(["a"]);
    expect(quantidade.motivos.a).toEqual(["quantidade"]);

    const espaco = selecionarParaRetencao(
      arquivos,
      { maxIdadeMs: 0, maxArquivos: 0, maxBytesTotais: 150 },
      BASE + 3_000
    );
    expect(espaco.remover.map((alvo) => alvo.segmentoId)).toEqual(["a", "b"]);
    expect(espaco.motivos).toEqual({ a: ["espaco"], b: ["espaco"] });
  });

  it("preserva explicitamente trechos associados a eventos importantes", () => {
    const resultado = selecionarParaRetencao(
      arquivos,
      {
        maxIdadeMs: 0,
        maxArquivos: 1,
        maxBytesTotais: 0,
        preservarSegmentoIds: ["a"],
      },
      BASE + 3_000
    );
    expect(resultado.remover.map((alvo) => alvo.segmentoId)).toEqual(["b"]);
    expect(resultado.preservados).toEqual(["a"]);
  });

  it("rejeita limites inválidos em vez de interpretá-los como ilimitado", () => {
    expect(() =>
      selecionarParaRetencao(arquivos, { maxIdadeMs: -1, maxArquivos: 0, maxBytesTotais: 0 }, BASE)
    ).toThrow("maxIdadeMs");
  });

  it("aplica a política no armazenador e devolve motivos auditáveis", async () => {
    const dir = path.join(tmpDir, "videos");
    const armazenador = new ArmazenadorVideos({
      dir,
      retencaoMs: 1_000,
      maxArquivos: 0,
      maxBytesTotais: 0,
      preservarSegmentoIds: ["seg-2"],
    });
    await armazenador.guardar(segmento(), upload(new Uint8Array([1, 2, 3])));
    await armazenador.guardar(
      segmento({ segmentoId: "seg-2", sessaoId: "sessao-2" }),
      upload(new Uint8Array([4, 5, 6]))
    );
    const resultado = await armazenador.aplicarPoliticaRetencao(BASE + 2_000);
    expect(resultado.removidos.map((alvo) => alvo.segmentoId)).toEqual(["seg-1"]);
    expect(resultado.motivos["seg-1"]).toEqual(["idade"]);
    expect(resultado.preservados).toEqual(["seg-2"]);
  });
});

describe("Fase 7 — criptografia em repouso", () => {
  it("cifra, autentica e decifra com a chave correta", () => {
    const chave = Buffer.alloc(32, 7);
    const cifrador = criarCifradorVideo(chave);
    expect(cifrador?.id).toBe("aes-256-gcm:v1");
    const claro = Buffer.from("conteudo-de-video");
    const cifrado = cifrador!.cifrar(claro);
    expect(cifrado.subarray(0, 4).toString("ascii")).toBe("NVG1");
    expect(cifrado.equals(claro)).toBe(false);
    expect(cifrador!.decifrar(cifrado).equals(claro)).toBe(true);

    const outro = criarCifradorVideo(Buffer.alloc(32, 8))!;
    expect(() => outro.decifrar(cifrado)).toThrow(/autenticar/);
    expect(() => cifrador!.decifrar(Buffer.from("curto"))).toThrow(/formato/);
  });

  it("interpreta chave base64/hex e rejeita tamanho inválido", () => {
    const chave = Buffer.alloc(32, 3);
    expect(interpretarChaveVideo(chave.toString("base64"))?.equals(chave)).toBe(true);
    expect(interpretarChaveVideo(chave.toString("hex"))?.equals(chave)).toBe(true);
    expect(interpretarChaveVideo(undefined)).toBeUndefined();
    expect(() => interpretarChaveVideo("curta")).toThrow("32 bytes");
  });

  it("marca o metadado e recusa leitura sem a chave", async () => {
    const dir = path.join(tmpDir, "videos-cifrados");
    const cifrador = criarCifradorVideo(Buffer.alloc(32, 9))!;
    const armazenador = new ArmazenadorVideos({ dir, cifrador });
    await armazenador.guardar(segmento(), upload(new Uint8Array([1, 2, 3, 4])));

    const bruto = await readFile(path.join(dir, "seg-1.video"));
    expect(bruto.subarray(0, 4).toString("ascii")).toBe("NVG1");
    expect((await armazenador.listar())[0].cifrado).toBe("aes-256-gcm:v1");
    expect((await armazenador.obter("seg-1"))?.bytes.equals(Buffer.from([1, 2, 3, 4]))).toBe(true);

    const semChave = new ArmazenadorVideos({ dir });
    await expect(semChave.obter("seg-1")).rejects.toMatchObject({
      motivo: "cifragem_indisponivel",
    });
  });
});

describe("Fase 7 — recuperação após queda", () => {
  const planoBasico = () =>
    planejarRecuperacaoMonitoramento({
      sessoes: [
        sessao(),
        sessao({ sessaoId: "sessao-fechada", estado: "encerrada", encerradaEmMs: BASE + 500 }),
      ],
      segmentos: [
        segmento({
          segmentoId: "aberto",
          estado: "gravando",
          motivoFim: undefined,
          fimMs: BASE,
          fimEm: new Date(BASE).toISOString(),
        }),
        segmento({ segmentoId: "sem-arquivo" }),
      ],
      arquivosVideo: [{ segmentoId: "outro" }],
      agoraMs: BASE + 10_000,
    });

  it("fecha sessão abandonada e marca segmento aberto como incompleto com lacuna", () => {
    const plano = planoBasico();
    const recuperada = plano.recuperacoes[0].recuperada;
    expect(recuperada).toMatchObject({ estado: "interrompida", encerradaEmMs: BASE + 10_000 });
    const incompleto = plano.recuperacoes[0].segmentos[0].recuperado;
    expect(incompleto).toMatchObject({ estado: "incompleto", motivoFim: "lacuna", fimMs: BASE });
    expect(incompleto.lacunas).toHaveLength(1);
    expect(incompleto.lacunas[0]).toMatchObject({
      inicioMs: BASE,
      fimMs: BASE + 10_000,
      duracaoMs: 10_000,
      motivo: "falha",
    });
    // O trecho sem quadros não é coberto pelo vídeo: fimMs continua no último quadro.
    expect(incompleto.fimMs).toBeLessThan(BASE + 10_000);
  });

  it("sinaliza uploads pendentes sem afirmar que o vídeo existe", () => {
    const plano = planoBasico();
    expect(plano.uploadsPendentes).toEqual(["sem-arquivo"]);
    expect(plano.observacoes.join(";")).toContain("sem_arquivo_de_video:1");
    expect(plano.recuperacoes).toHaveLength(1);
  });

  it("aplica o plano ao índice append-only de forma idempotente", async () => {
    const sessoesFile = path.join(tmpDir, "monitoramento-sessoes.jsonl");
    const segmentosFile = path.join(tmpDir, "monitoramento-segmentos.jsonl");
    await gravarSessaoMonitoramento(sessao(), sessoesFile, 1_000_000);
    await gravarSegmentoMonitoramento(
      segmento({ segmentoId: "aberto", estado: "gravando", motivoFim: undefined }),
      segmentosFile,
      1_000_000
    );

    const primeiro = await aplicarRecuperacaoMonitoramento({
      sessoesFile,
      segmentosFile,
      arquivosVideo: [],
      agoraMs: BASE + 10_000,
    });
    expect(primeiro.sessoesAtualizadas).toBe(1);
    expect(primeiro.segmentosAtualizados).toBe(1);
    const sessoes = await lerSessoesMonitoramento(sessoesFile, 100);
    const segmentos = await lerSegmentosMonitoramento(segmentosFile, 100);
    expect(sessoes[0].estado).toBe("interrompida");
    expect(segmentos[0].estado).toBe("incompleto");

    const segundo = await aplicarRecuperacaoMonitoramento({
      sessoesFile,
      segmentosFile,
      arquivosVideo: [],
      agoraMs: BASE + 20_000,
    });
    expect(segundo.sessoesAtualizadas).toBe(0);
    expect(segundo.segmentosAtualizados).toBe(0);
  });
});

describe("Fase 7 — autenticação opcional", () => {
  it("mantém o modo sem token inalterado e o ator anônimo", () => {
    const politica = politicaAutenticacao("");
    expect(politica.obrigatoria).toBe(false);
    const req = { headers: {} } as unknown as Parameters<typeof autenticarRequisicao>[0];
    expect(autenticarRequisicao(req, politica)).toEqual({ autenticada: true, ator: "anonimo" });
  });

  it("aceita Bearer e cookie assinado; nunca devolve o segredo no ator", () => {
    const politica = politicaAutenticacao(TOKEN);
    const bearer = { headers: { authorization: `Bearer ${TOKEN}` } } as unknown as Parameters<
      typeof autenticarRequisicao
    >[0];
    const identidade = autenticarRequisicao(bearer, politica, BASE);
    expect(identidade.autenticada).toBe(true);
    expect(identidade.ator).toBe(identificadorAtor(TOKEN));
    expect(identidade.ator).not.toContain(TOKEN);

    const invalido = { headers: { authorization: "Bearer errado" } } as unknown as Parameters<
      typeof autenticarRequisicao
    >[0];
    expect(autenticarRequisicao(invalido, politica, BASE).autenticada).toBe(false);

    const cookie = criarCookieSessao(TOKEN, BASE);
    expect(validarCookieSessao(cookie, TOKEN, BASE)).toBe(true);
    expect(validarCookieSessao(cookie, TOKEN, BASE + 13 * 60 * 60 * 1000)).toBe(false);
    expect(validarCookieSessao(cookie, "outro", BASE)).toBe(false);
    const comCookie = { headers: { cookie: `neuro_sessao=${cookie}; outro=1` } } as unknown as Parameters<
      typeof autenticarRequisicao
    >[0];
    expect(autenticarRequisicao(comCookie, politica, BASE).autenticada).toBe(true);
  });
});

async function subirServidor(config: Parameters<typeof criarServer>[0] = {}): Promise<string> {
  const server = criarServer({
    logFile: path.join(tmpDir, "visao.jsonl"),
    auditoriaFile: path.join(tmpDir, "auditoria.jsonl"),
    ...config,
  });
  servidores.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

/** A gravação da trilha é best-effort e assíncrona; aguarda o flush dos registros. */
async function aguardarTrilha(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 50));
}

describe("Fase 7 — integração HTTP de acesso e auditoria", () => {
  it("bloqueia API sem token, serve login e registra a tentativa", async () => {
    const base = await subirServidor({
      autenticacao: { obrigatoria: true, token: TOKEN },
    });
    const semToken = await fetch(`${base}/api/eventos`);
    expect(semToken.status).toBe(401);
    expect((await semToken.json() as { erro: string }).erro).toBe("nao_autenticado");

    const loginPage = await fetch(`${base}/`);
    expect(loginPage.status).toBe(200);
    expect(await loginPage.text()).toContain("Token de acesso");

    const health = await fetch(`${base}/api/health`);
    expect(health.status).toBe(200);

    const falha = await fetch(`${base}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "errado" }),
    });
    expect(falha.status).toBe(401);

    const sucesso = await fetch(`${base}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: TOKEN }),
    });
    expect(sucesso.status).toBe(200);
    const cookie = sucesso.headers.get("set-cookie");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).not.toContain(TOKEN);

    const autorizada = await fetch(`${base}/api/eventos`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(autorizada.status).toBe(200);

    await aguardarTrilha();
    const auditoria = await lerAuditoria(path.join(tmpDir, "auditoria.jsonl"), 100);
    const acoes = auditoria.map((registro) => registro.acao);
    expect(acoes).toContain("acesso_negado");
    expect(acoes).toContain("login_falha");
    expect(acoes).toContain("login_sucesso");
    expect(auditoria.every((registro) => !JSON.stringify(registro).includes(TOKEN))).toBe(true);
  });

  it("audita exportação, listagem de vídeo, retenção e limpeza de eventos", async () => {
    const base = await subirServidor({
      autenticacao: { obrigatoria: true, token: TOKEN },
    });
    const headers = { Authorization: `Bearer ${TOKEN}` };
    const exportacao = await fetch(`${base}/api/eventos/exportar`, { headers });
    expect(exportacao.status).toBe(200);
    const videos = await fetch(`${base}/api/monitoramento/videos`, { headers });
    expect(videos.status).toBe(200);
    const retencao = await fetch(`${base}/api/monitoramento/videos/retencao?agoraMs=${BASE}`, {
      method: "POST",
      headers,
    });
    expect(retencao.status).toBe(200);
    const limpeza = await fetch(`${base}/api/eventos`, { method: "DELETE", headers });
    expect(limpeza.status).toBe(200);

    await aguardarTrilha();
    const auditoria = await lerAuditoria(path.join(tmpDir, "auditoria.jsonl"), 100);
    const porAcao = new Map(auditoria.map((registro) => [registro.acao, registro]));
    expect(porAcao.get("exportacao_eventos")?.resultado).toBe("sucesso");
    expect(porAcao.get("acesso_video")?.resultado).toBe("sucesso");
    expect(porAcao.get("aplicacao_retencao")?.resultado).toBe("sucesso");
    expect(porAcao.get("limpeza_eventos")?.resultado).toBe("sucesso");
    expect(auditoria.every((registro) => registro.ator === identificadorAtor(TOKEN))).toBe(true);
  });

  it("preserva a trilha mesmo quando o histórico é apagado", async () => {
    const auditoriaFile = path.join(tmpDir, "auditoria.jsonl");
    const base = await subirServidor({ auditoriaFile, autenticacao: { obrigatoria: false } });
    await writeFile(path.join(tmpDir, "eventos.jsonl"), `${JSON.stringify({ tipo: "x" })}\n`);
    const resposta = await fetch(`${base}/api/eventos`, { method: "DELETE" });
    expect(resposta.status).toBe(200);
    await aguardarTrilha();
    const trilha = await readFile(auditoriaFile, "utf8");
    expect(trilha).toContain('"acao":"limpeza_eventos"');
  });
});
