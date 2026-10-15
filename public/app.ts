import type { Caixa, EntradaLog, MotivoAnalise } from "../src/types";
import { colapsarRepeticoes } from "../src/texto";
import { entradaDeResultado } from "../src/percepcao";
import type { MotorPercepcao, ResultadoPercepcao } from "../src/percepcao";
import { RastreadorObjetos } from "../src/rastreamento";
import { DetectorMudancaDeCena } from "../src/cena";
import { ehCancelamento } from "../src/erros";
import { PoliticaAnalise, comMotivo, rotuloMotivo } from "../src/politica-analise";
import { AgendadorAnalise } from "./scheduler";
import * as api from "./api";
import { DetectorObjetos } from "./detector";
import { Camera, ErroCamera } from "./camera";
import { MotorVisao } from "./motores";
import { obterModo } from "./modos";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Elemento #${id} nao encontrado`);
  return node as T;
}

const video = el<HTMLVideoElement>("video");
const overlay = el<HTMLCanvasElement>("overlay");
const maybeCtx = overlay.getContext("2d");
if (!maybeCtx) throw new Error("Canvas 2D indisponivel");
const ctx = maybeCtx;
const camera = new Camera(video);

const placeholder = el<HTMLDivElement>("placeholder");
const statusEl = el<HTMLDivElement>("status");
const spinnerEl = el<HTMLDivElement>("spinner");
const modeloStatusEl = el<HTMLSpanElement>("modeloStatus");
const diagInfoEl = el<HTMLSpanElement>("diagInfo");
const gpuWarningEl = el<HTMLDivElement>("gpuWarning");
const logEl = el<HTMLUListElement>("log");
const logCountEl = el<HTMLSpanElement>("logCount");
const clearLogBtn = el<HTMLButtonElement>("clearLog");
const exportBtn = el<HTMLButtonElement>("exportLog");
const filterInput = el<HTMLInputElement>("filter");
const startBtn = el<HTMLButtonElement>("start");
const stopBtn = el<HTMLButtonElement>("stop");
const analisarAgoraBtn = el<HTMLButtonElement>("analisarAgora");
const modelSelect = el<HTMLSelectElement>("model");
const motorSelect = el<HTMLSelectElement>("motor");
const intervalInput = el<HTMLInputElement>("interval");
const intervalValue = el<HTMLSpanElement>("intervalValue");
const thresholdInput = el<HTMLInputElement>("threshold");
const thresholdValue = el<HTMLSpanElement>("thresholdValue");

function gerarSessaoCurta(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID().slice(0, 8);
  }
  let result = "";
  for (let i = 0; i < 8; i += 1) {
    result += Math.floor(Math.random() * 16).toString(16);
  }
  return result;
}

const detectorCoco = new DetectorObjetos();
let sessaoId = gerarSessaoCurta();
const rastreador = new RastreadorObjetos({}, sessaoId);
const detectorCena = new DetectorMudancaDeCena({}, sessaoId);
let motorAtual: MotorPercepcao | null = null;
let running = false;
let controller: AbortController | null = null;
let ultimaDescricao = "";
let ultimaDuracaoMs = 0;
let roteiroBeats: string[] = [];
let roteiroPrimeiro = true;
let intervaloMsConfigurado = Number(intervalInput.value) * 1000;
let frameIdAtual: string | null = null;
let manualSolicitado = false;
const politica = new PoliticaAnalise();
function gerarFrameId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID().slice(0, 12);
  }
  let result = "";
  for (let i = 0; i < 12; i += 1) {
    result += Math.floor(Math.random() * 16).toString(16);
  }
  return result;
}
function gerarIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Ultimo status do backend de visao conhecido (motor/modelos/carregados), para o diagnostico. */
let infoVisao: api.InfoVisao | null = null;
/** Tempo de carregamento do modelo na ultima inicializacao (ms). */
let ultimaCargaMs = 0;
/** Tempo da ultima gravacao no servidor (persistencia), em ms. */
let ultimaPersistenciaMs = 0;

const agendador = new AgendadorAnalise({
  executar: () => analisar(),
  obterIntervaloMs: () => intervaloMsConfigurado,
});

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function setSpinner(ativo: boolean): void {
  spinnerEl.hidden = !ativo;
}

/** Modelo de deteccao em uso no navegador, ou "—" quando o motor nao precisa dele. */
function modeloDeDeteccaoAtivo(): string | null {
  return obterModo(motorSelect.value).usaDeteccao ? modelSelect.value : null;
}

/** Rotulo curto do backend de visao em uso (LM Studio). */
function rotuloBackend(): string {
  return "LM Studio";
}

/**
 * Linha de diagnostico (Fase 6.3): mostra o motor ativo, o modelo solicitado,
 * o modelo carregado no backend de visao e separa **carga**, **inferencia** e
 * **persistencia** — para distinguir lentidao de modelo de lentidao de disco.
 */
function atualizarDiagnostico(): void {
  const motor = running ? motorSelect.value : "parado";
  const definicao = obterModo(motorSelect.value);
  const deteccao = modeloDeDeteccaoAtivo();
  const modeloVisao = infoVisao?.modelo ?? "?";
  const modelo =
    definicao.usaDeteccao && definicao.usaVisao
      ? `${deteccao} + ${modeloVisao}`
      : deteccao ?? modeloVisao;
  const carregados = !infoVisao
    ? "?"
    : infoVisao.online === false
      ? "offline"
      : infoVisao.carregados?.length
        ? infoVisao.carregados.join(", ")
        : "nenhum";

  const partes = [`motor ${motor}`, `backend ${rotuloBackend()}`, `modelo ${modelo}`, `carregados: ${carregados}`];
  if (infoVisao?.solicitado && infoVisao.solicitado !== infoVisao.modelo) {
    partes.push(`fallback de ${infoVisao.solicitado}`);
  }
  if (ultimaCargaMs > 0) partes.push(`carga ${(ultimaCargaMs / 1000).toFixed(1)}s`);
  if (ultimaDuracaoMs > 0) partes.push(`inferencia ${ultimaDuracaoMs} ms`);
  if (ultimaPersistenciaMs > 0) partes.push(`persistencia ${ultimaPersistenciaMs} ms`);

  diagInfoEl.textContent = `Diagnostico: ${partes.join(" · ")}`;
  diagInfoEl.title = partes.join("\n");
}

/**
 * Aviso persistente de fallback de CPU (Fase 6.3): mostrado quando a deteccao
 * roda em WASM em vez de WebGPU. Nao e escondido depois — permanece ate
 * recarregar a pagina, para o usuario saber que a lentidao e esperada.
 */
function mostrarAvisoDispositivo(): void {
  if (modeloDeDeteccaoAtivo() === null) return;
  if (detectorCoco.dispositivo !== "wasm") return;
  const temGpu = Boolean((navigator as Navigator & { gpu?: unknown }).gpu);
  gpuWarningEl.textContent = temGpu
    ? "Aviso: o WebGPU não pôde ser usado — a detecção está rodando na CPU (WASM) e será mais lenta."
    : "Aviso: este navegador não oferece WebGPU — a detecção está rodando na CPU (WASM) e será mais lenta.";
  gpuWarningEl.hidden = false;
}

/** "Analisar agora" so faz sentido no modo eventos, com a sessao rodando. */
function atualizarBotoesAnalise(): void {
  analisarAgoraBtn.disabled = !running || !obterModo(motorSelect.value).permiteAnaliseManual;
}

/**
 * Trocar o motor ou o modelo exige reinicializar o motor ativo, o que o
 * agendador nao faz em execucao. Para nao rodar com uma combinacao incoerente
 * (ex.: `motorAtual` antigo), os seletores ficam bloqueados enquanto a captura
 * esta ativa e so voltam a ficar disponiveis ao parar.
 */
function habilitarSeletoresDeMotor(habilitado: boolean): void {
  motorSelect.disabled = !habilitado;
  modelSelect.disabled = !habilitado;
}

function drawBoxes(objetos: ReadonlyArray<{ nome: string; score: number; caixa: Caixa }>): void {
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  ctx.lineWidth = 3;
  ctx.font = "16px 'Segoe UI', sans-serif";
  ctx.textBaseline = "top";

  for (const o of objetos) {
    const { xmin, ymin, xmax, ymax } = o.caixa;
    ctx.strokeStyle = "#4f9cf9";
    ctx.strokeRect(xmin, ymin, xmax - xmin, ymax - ymin);

    const label = `${o.nome} ${(o.score * 100).toFixed(0)}%`;
    const textWidth = ctx.measureText(label).width;
    ctx.fillStyle = "#4f9cf9";
    ctx.fillRect(xmin, ymin, textWidth + 12, 22);
    ctx.fillStyle = "#fff";
    ctx.fillText(label, xmin + 6, ymin + 3);
  }
}

function atualizarContagem(): void {
  const total = logEl.children.length;
  logCountEl.textContent = String(total);
  clearLogBtn.disabled = total === 0;
  exportBtn.disabled = total === 0;
}

function criarItem(entry: EntradaLog): HTMLLIElement {
  const li = document.createElement("li");

  if (entry.snapshot) {
    const img = document.createElement("img");
    img.className = "thumb";
    img.src = entry.snapshot;
    img.alt = "frame capturado";
    img.loading = "lazy";
    if (entry.capturadoEm) {
      img.title = `Frame capturado às ${new Date(entry.capturadoEm).toLocaleTimeString("pt-BR")}`;
    }
    li.appendChild(img);
  }

  const corpo = document.createElement("div");
  corpo.className = "corpo";

  const cabecalho = document.createElement("div");
  cabecalho.className = "cabecalho";
  const time = document.createElement("span");
  time.className = "time";
  // O horario exibido e o da CAPTURA do frame (quando o snapshot foi tirado);
  // `timestamp` e o fim da analise. A diferenca entre os dois e o atraso de
  // inferencia, revelado no tooltip.
  const capturadoEm = entry.capturadoEm ? new Date(entry.capturadoEm) : null;
  const analisadoEm = new Date(entry.timestamp);
  time.textContent = (capturadoEm ?? analisadoEm).toLocaleTimeString("pt-BR");
  if (capturadoEm) {
    const atrasoS = (analisadoEm.getTime() - capturadoEm.getTime()) / 1000;
    time.title =
      atrasoS >= 1
        ? `Frame capturado às ${capturadoEm.toLocaleTimeString("pt-BR")} · analisado ${atrasoS.toFixed(1)}s depois`
        : `Frame capturado às ${capturadoEm.toLocaleTimeString("pt-BR")}`;
  }
  cabecalho.appendChild(time);
  if (entry.modelo) {
    const meta = document.createElement("span");
    meta.className = "meta";
    let texto = entry.modelo;
    if (entry.ms && entry.tokens) {
      const tokS = Math.round(entry.tokens / (entry.ms / 1000));
      texto += ` · ${entry.tokens} toks em ${Math.round(entry.ms / 1000)}s (${tokS} tok/s)`;
    }
    if (capturadoEm && analisadoEm.getTime() - capturadoEm.getTime() >= 1000) {
      texto += ` · frame analisado ${((analisadoEm.getTime() - capturadoEm.getTime()) / 1000).toFixed(1)}s depois`;
    }
    if (entry.motivo) {
      texto += ` · por ${rotuloMotivo(entry.motivo)}`;
    }
    meta.textContent = texto;
    cabecalho.appendChild(meta);
  }
  corpo.appendChild(cabecalho);

  const objs = document.createElement("div");
  objs.className = "objs";
  if (entry.tipo === "descricao" || entry.tipo === "roteiro") {
    if (entry.tipo === "roteiro") {
      const badge = document.createElement("span");
      badge.className = "tag papel";
      badge.textContent = entry.papel === "base" ? "roteiro base" : "roteiro +";
      objs.appendChild(badge);
    }
    const span = document.createElement("span");
    span.className = "desc";
    span.textContent = entry.resumo;
    objs.appendChild(span);
  } else if (entry.objetos.length === 0) {
    const span = document.createElement("span");
    span.className = "empty";
    span.textContent = "nada reconhecido";
    objs.appendChild(span);
  } else {
    for (const o of entry.objetos) {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = `${o.nome} ${(o.score * 100).toFixed(0)}%`;
      objs.appendChild(tag);
    }
  }
  corpo.appendChild(objs);
  li.appendChild(corpo);
  return li;
}

function addLogEntry(entry: EntradaLog): void {
  logEl.prepend(criarItem(entry));
  atualizarContagem();
}

function limparLista(): void {
  logEl.replaceChildren();
}

async function carregarHistorico(): Promise<void> {
  try {
    const entradas = await api.listarEntradas(100);
    logEl.replaceChildren(...entradas.map(criarItem));
    atualizarContagem();
  } catch {
    // historico indisponivel; segue vazio
  }
}

/**
 * Reidrata o contexto da sessao a partir da memoria persistida (roteiro recente
 * e ultima descricao), em vez de comecar sempre do zero.
 */
async function carregarContexto(): Promise<void> {
  try {
    const contexto = await api.obterContexto();
    if (!contexto) return;
    roteiroBeats = contexto.roteiro.slice(-64);
    ultimaDescricao = contexto.ultimaDescricao;
  } catch {
    // memoria indisponivel; segue sem contexto reidratado
  }
}

async function limparHistorico(): Promise<void> {
  clearLogBtn.disabled = true;
  const retomar = running;
  try {
    // Fase 5: limpar historico e um limite de contexto. Nenhum evento novo pode
    // depender do estado temporal anterior nem surgir de um ciclo em andamento.
    if (retomar) agendador.parar();
    while (agendador.estaExecutando) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    await api.limparHistorico();
    // Reseta toda a percepcao temporal, nao apenas a lista visivel.
    sessaoId = gerarSessaoCurta();
    rastreador.reiniciar();
    if (typeof (rastreador as { definirSessao?: (s: string) => void }).definirSessao === "function") {
      (rastreador as { definirSessao: (s: string) => void }).definirSessao(sessaoId);
    }
    detectorCena.reiniciar();
    if (typeof (detectorCena as { definirSessao?: (s: string) => void }).definirSessao === "function") {
      (detectorCena as { definirSessao: (s: string) => void }).definirSessao(sessaoId);
    }
    politica.reiniciar();
    frameIdAtual = gerarFrameId();
  manualSolicitado = false;
    ultimaDescricao = "";
    roteiroBeats = [];
    roteiroPrimeiro = true;
    limparLista();
    atualizarContagem();
    setStatus("Historico limpo.");
    if (retomar) await agendador.iniciar();
  } catch (err) {
    setStatus(`Falha ao limpar historico: ${(err as Error).message}`);
    atualizarContagem();
    if (retomar && !agendador.estaRodando) await agendador.iniciar();
  }
}

/** Registra uma falha/metrica operacional (nao e um acontecimento visual). */
function registrarOperacional(
  nivel: "info" | "aviso" | "erro",
  origem: string,
  mensagem: string
): void {
  void api.gravarOperacional({ nivel, origem, mensagem });
}

/**
 * Persiste uma entrada no servidor medindo o tempo de gravacao (persistencia),
 * para diferenciar essa etapa da inferencia no diagnostico.
 */
async function persistirEntrada(entry: EntradaLog): Promise<void> {
  const inicio = performance.now();
  try {
    await api.gravarEntrada(entry);
    ultimaPersistenciaMs = Math.round(performance.now() - inicio);
  } catch {
    if (running) setStatus("Falha ao gravar no log do servidor");
  }
  atualizarDiagnostico();
}

async function analisarComVisao(
  signal: AbortSignal,
  ehRoteiro: boolean,
  motivo?: MotivoAnalise | null,
  capturaVisao?: { imagem: string; thumb: string; capturadoEm: string }
): Promise<void> {
  const capturadoEm = capturaVisao?.capturadoEm ?? new Date().toISOString();
  const dataUrl = capturaVisao?.imagem ?? camera.capturarFrame(512);
  if (dataUrl === null) return;
  const width = camera.largura;
  const height = camera.altura;
  overlay.width = width;
  overlay.height = height;
  ctx.clearRect(0, 0, width, height);

  const base64 = dataUrl.split(",")[1] ?? "";
  setStatus(`${rotuloBackend()} analisando frame... (pode demorar)`);

  const motor = new MotorVisao({
    modo: ehRoteiro ? "roteiro" : "descricao",
    roteiro: ehRoteiro ? roteiroBeats.slice(-8).join(" ").slice(0, 1200) : undefined,
    base: ehRoteiro ? roteiroPrimeiro : undefined,
    anterior: ehRoteiro ? undefined : ultimaDescricao,
    motivo: motivo ?? undefined,
  });

  let resultado: ResultadoPercepcao | null;
  try {
    resultado = await motor.analisar(
      { imagem: base64, snapshot: dataUrl, capturadoEm },
      signal,
      (parcial) => setStatus(`${rotuloBackend()}: ${colapsarRepeticoes(parcial)}`)
    );
  } catch (err) {
    if (ehCancelamento(err) || signal.aborted) return;
    registrarOperacional("erro", "visao", (err as Error).message);
    setStatus((err as Error).message);
    return;
  }
  if (signal.aborted || !resultado) return;
  ultimaDuracaoMs = resultado.duracaoMs;

  if (ehRoteiro && resultado.confianca?.semMudanca) {
    setStatus(`Sem mudancas neste intervalo (${resultado.duracaoMs} ms).`);
    return;
  }

  if (ehRoteiro) {
    if (roteiroPrimeiro) roteiroPrimeiro = false;
    roteiroBeats.push(colapsarRepeticoes(resultado.descricao ?? ""));
    if (roteiroBeats.length > 64) roteiroBeats.splice(0, roteiroBeats.length - 64);
  }

  const entry = comMotivo(
    { ...entradaDeResultado(resultado, ehRoteiro ? "roteiro" : "descricao"), frameId: frameIdAtual ?? undefined },
    motivo
  );
  ultimaDescricao = resultado.descricao ?? "";
  addLogEntry(entry);

  const tokens = resultado.confianca?.tokens;
  if (tokens) {
    const tokS =
      resultado.duracaoMs > 0 ? Math.round(tokens / (resultado.duracaoMs / 1000)) : 0;
    setStatus(
      `${rotuloBackend()} viu: ${resultado.descricao} (${resultado.duracaoMs} ms · ${tokens} toks · ${tokS} tok/s)`
    );
  } else {
    setStatus(`${rotuloBackend()} viu: ${resultado.descricao} (${resultado.duracaoMs} ms)`);
  }
}

async function analisarDeteccao(signal: AbortSignal): Promise<void> {
  const width = camera.largura;
  const height = camera.altura;
  if (!width || !height) return;
  overlay.width = width;
  overlay.height = height;

  // Captura o frame UMA unica vez: o mesmo instante alimenta a analise, o
  // snapshot do historico e a assinatura de cena. Sem isso o historico exibia
  // um segundo frame, capturado depois da inferencia, diferente do analisado.
  const capturadoMs = performance.now();
  const capturadoEm = new Date().toISOString();
  const captura = camera.capturarQuadro(0, 240);
  if (captura === null) return;
  const assinatura = camera.assinaturaDeCena();

  setStatus("Analisando frame...");
  let resultado: ResultadoPercepcao | null;
  try {
    if (!motorAtual) return;
    resultado = await motorAtual.analisar(
      { imagem: captura.imagem, snapshot: captura.thumb, capturadoEm },
      signal
    );
  } catch (err) {
    if (ehCancelamento(err) || signal.aborted) return;
    registrarOperacional("erro", "detector", (err as Error).message);
    setStatus(`Erro na inferencia: ${(err as Error).message}`);
    return;
  }
  if (signal.aborted || !resultado) return;
  ultimaDuracaoMs = resultado.duracaoMs;

  const agora = capturadoMs;
  const timestamp = capturadoEm;
  const quadro = rastreador.processar(resultado.objetos, agora, {
    timestamp,
    snapshot: resultado.snapshot,
    modelo: resultado.modelo,
    sessaoId,
  });
  const sinalCena = detectorCena.avaliar(assinatura, agora, {
    timestamp,
    snapshot: resultado.snapshot,
    modelo: resultado.modelo,
    sessaoId,
  });
  const eventos = sinalCena ? [...quadro.eventos, sinalCena] : quadro.eventos;
  drawBoxes(quadro.objetos);

  const entry = { ...entradaDeResultado(resultado, "deteccao"), frameId: frameIdAtual ?? undefined };
  addLogEntry(entry);
  const resumoEventos = eventos.map((e) => e.descricao).join(", ");
  setStatus(
    `Viu: ${entry.resumo}  (${resultado.duracaoMs} ms)${resumoEventos ? ` · ${resumoEventos}` : ""}`
  );

  for (const evt of eventos) {
    // Movimento e o evento mais frequente: grava sem snapshot para poupar disco.
    const paraGravar = evt.tipo === "movimento" ? { ...evt, snapshot: undefined } : evt;
    void api.gravarEvento({ ...paraGravar, frameId: frameIdAtual ?? undefined, sessaoId, idempotencyKey: gerarIdempotencyKey() }).catch(() => {
      if (running) setStatus("Falha ao gravar evento no servidor");
    });
  }

  void persistirEntrada(entry);
}

/**
 * Fluxo orientado a eventos (Fase 5): a percepcao leve roda a cada tick; o
 * modelo de visao so e chamado quando a politica decide que ha motivo (mudanca,
 * nova entidade, baixa confianca, resumo periodico, pedido manual ou falha
 * da percepcao — nunca tratada como ausencia de mudanca).
 */
async function analisarEventos(signal: AbortSignal): Promise<void> {
  const width = camera.largura;
  const height = camera.altura;
  if (!width || !height) return;
  overlay.width = width;
  overlay.height = height;

  const capturadoMs = performance.now();
  const capturadoEm = new Date().toISOString();
  const captura = camera.capturarQuadro(0, 240);
  if (captura === null) return;
  const assinatura = camera.assinaturaDeCena();

  const agora = capturadoMs;
  let resultado: ResultadoPercepcao | null;
  try {
    if (!motorAtual) return;
    resultado = await motorAtual.analisar(
      { imagem: captura.imagem, snapshot: captura.thumb, capturadoEm },
      signal
    );
  } catch (err) {
    if (ehCancelamento(err) || signal.aborted) return;
    registrarOperacional("erro", "detector", (err as Error).message);
    // Falha da percepcao leve = estado desconhecido. Nunca vira "sem mudanca":
    // deixa o modelo de visao julgar, respeitando a janela de chamadas.
    const decisao = politica.avaliar({
      agora,
      eventos: [],
      melhorConfianca: null,
      percepcaoValida: false,
      manual: manualSolicitado,
    });
    frameIdAtual = gerarFrameId();
  manualSolicitado = false;
    if (decisao.acionar) {
      politica.registrarChamada(agora);
      const motivo: MotivoAnalise | undefined =
        decisao.motivo === "sem_acao" ? undefined : decisao.motivo;
      setStatus(
        `Percepcao leve falhou; acionando o modelo de visao por ${rotuloMotivo(motivo ?? "falha_percepcao")}...`
      );
      await analisarComVisao(signal, false, motivo, { imagem: captura.imagem, thumb: captura.thumb, capturadoEm });
    } else {
      setStatus(`Percepcao leve falhou: ${(err as Error).message}`);
    }
    return;
  }
  if (signal.aborted || !resultado) return;
  ultimaDuracaoMs = resultado.duracaoMs;

  const timestamp = capturadoEm;
  const quadro = rastreador.processar(resultado.objetos, agora, {
    timestamp,
    snapshot: resultado.snapshot,
    modelo: resultado.modelo,
    sessaoId,
  });
  const sinalCena = detectorCena.avaliar(assinatura, agora, {
    timestamp,
    snapshot: resultado.snapshot,
    modelo: resultado.modelo,
    sessaoId,
  });
  const eventos = sinalCena ? [...quadro.eventos, sinalCena] : quadro.eventos;

  for (const evt of eventos) {
    // Movimento e o evento mais frequente: grava sem snapshot para poupar disco.
    const paraGravar = evt.tipo === "movimento" ? { ...evt, snapshot: undefined } : evt;
    void api.gravarEvento({ ...paraGravar, frameId: frameIdAtual ?? undefined, sessaoId, idempotencyKey: gerarIdempotencyKey() }).catch(() => {
      if (running) setStatus("Falha ao gravar evento no servidor");
    });
  }

  const menorScore =
    resultado.objetos.length > 0
      ? Math.min(...resultado.objetos.map((o) => o.score))
      : null;
  const decisao = politica.avaliar({
    agora,
    eventos,
    melhorConfianca: menorScore,
    percepcaoValida: true,
    manual: manualSolicitado,
  });
  frameIdAtual = gerarFrameId();
  manualSolicitado = false;

  if (decisao.acionar) {
    politica.registrarChamada(agora);
    const motivo: MotivoAnalise | undefined =
      decisao.motivo === "sem_acao" ? undefined : decisao.motivo;
    setStatus(`Modelo de visao acionado: ${rotuloMotivo(motivo ?? "manual")}...`);
    await analisarComVisao(signal, false, motivo, { imagem: captura.imagem, thumb: captura.thumb, capturadoEm });
    if (signal.aborted) return;
    // O modelo de visao limpa o canvas; desenha as caixas de novo por cima.
    drawBoxes(quadro.objetos);
    return;
  }

  drawBoxes(quadro.objetos);
  const entry = { ...entradaDeResultado(resultado, "deteccao"), frameId: frameIdAtual ?? undefined };
  addLogEntry(entry);
  setStatus(`Viu: ${entry.resumo} (${resultado.duracaoMs} ms) · sem mudanca relevante`);
  void persistirEntrada(entry);
}

async function analisar(): Promise<void> {
  if (!running) return;
  const ctrl = new AbortController();
  controller = ctrl;
  const { signal } = ctrl;
  setSpinner(true);
  try {
    const modo = motorSelect.value;
    if (modo === "visao" || modo === "roteiro") {
      await analisarComVisao(signal, modo === "roteiro");
      return;
    }
    if (modo === "eventos") {
      await analisarEventos(signal);
      return;
    }
    await analisarDeteccao(signal);
  } finally {
    if (controller === ctrl) {
      controller = null;
      setSpinner(false);
    }
  }
}

/** Inicializa o motor ativo exibindo o spinner durante o carregamento. */
async function inicializarMotor(motor: MotorPercepcao): Promise<void> {
  setSpinner(true);
  try {
    await motor.inicializar(setStatus);
  } finally {
    setSpinner(false);
  }
}

async function start(): Promise<void> {
  if (running) return;
  startBtn.disabled = true;
  habilitarSeletoresDeMotor(false);
  // `roteiroBeats`/`ultimaDescricao` vem do contexto reidratado (`carregarContexto`):
  // se ja existe roteiro persistido, o proximo beat e um delta, nao a base.
  ultimaDuracaoMs = 0;
  roteiroPrimeiro = roteiroBeats.length === 0;
  sessaoId = gerarSessaoCurta();
  frameIdAtual = null;
  rastreador.reiniciar();
  if (typeof (rastreador as { definirSessao?: (s: string) => void }).definirSessao === "function") {
    (rastreador as { definirSessao: (s: string) => void }).definirSessao(sessaoId);
  }
  detectorCena.reiniciar();
  if (typeof (detectorCena as { definirSessao?: (s: string) => void }).definirSessao === "function") {
    (detectorCena as { definirSessao: (s: string) => void }).definirSessao(sessaoId);
  }

  try {
    await camera.iniciar();
  } catch (err) {
    registrarOperacional("erro", "camera", (err as Error).message);
    if (err instanceof ErroCamera && err.fase === "video") {
      falharInicializacao(`Falha ao iniciar o video: ${err.message}`);
    } else {
      falharInicializacao(`Nao foi possivel acessar a webcam: ${(err as Error).message}`);
    }
    return;
  }
  placeholder.style.display = "none";

  // A partir daqui a webcam esta ligada: qualquer falha inesperada precisa
  // liberar as faixas de video via `falharInicializacao` -> `encerrarCaptura`.
  try {
    const definicao = obterModo(motorSelect.value);
    const motor = definicao.criarMotor({
      detector: detectorCoco,
      modelo: modelSelect.value,
      obterThreshold: () => Number(thresholdInput.value),
    });
    motorAtual = motor;
    const inicioCarga = performance.now();
    try {
      await inicializarMotor(motor);
      ultimaCargaMs = Math.round(performance.now() - inicioCarga);
    } catch (err) {
      registrarOperacional("erro", definicao.origemFalha, (err as Error).message);
      falharInicializacao(`${definicao.falhaPrefixo}: ${(err as Error).message}`);
      return;
    }
    if (definicao.usaDeteccao) mostrarAvisoDispositivo();

    if (!camera.ativa) {
      falharInicializacao("A camera foi encerrada durante a inicializacao.");
      return;
    }
    running = true;
    politica.reiniciar();
    stopBtn.disabled = false;
    atualizarBotoesAnalise();
    atualizarDiagnostico();
    // Atualiza o "carregado" do modelo de visao agora que ele pode ter subido.
    void verificarVisao();
    await agendador.iniciar();
  } catch (err) {
    registrarOperacional("erro", "inicializacao", (err as Error).message);
    falharInicializacao(`Falha ao iniciar: ${(err as Error).message}`);
  }
}

function encerrarCaptura(): void {
  running = false;
  agendador.parar();
  if (controller) {
    controller.abort();
    controller = null;
  }
  motorAtual?.encerrar();
  motorAtual = null;
  camera.encerrar();
}

function restaurarInterfaceIdle(): void {
  setSpinner(false);
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  placeholder.style.display = "grid";
  startBtn.disabled = false;
  stopBtn.disabled = true;
  analisarAgoraBtn.disabled = true;
  habilitarSeletoresDeMotor(true);
}

function falharInicializacao(mensagem: string): void {
  encerrarCaptura();
  restaurarInterfaceIdle();
  atualizarDiagnostico();
  setStatus(mensagem);
}

function stop(): void {
  encerrarCaptura();
  restaurarInterfaceIdle();
  atualizarDiagnostico();
  setStatus("Parado.");
}

async function verificarVisao(): Promise<void> {
  try {
    const o = await api.saudeVisao();
    infoVisao = o;
    if (o?.online) {
      const memoria = o.carregados?.length ? ` · em memoria: ${o.carregados.join(", ")}` : "";
      modeloStatusEl.textContent = `${rotuloBackend()}: online${o.modelos.length ? " (" + o.modelos.join(", ") + ")" : ""}${memoria}`;
      modeloStatusEl.className = "health online";
      modeloStatusEl.title = (o.modelos.join("\n") || `${rotuloBackend()} acessivel`) + (memoria ? `\n${memoria}` : "");
    } else {
      modeloStatusEl.textContent = `${rotuloBackend()}: offline${o?.erro ? " — " + o.erro : ""}`;
      modeloStatusEl.className = "health offline";
      modeloStatusEl.title = o?.erro ?? `${rotuloBackend()} inacessivel`;
    }
  } catch {
    infoVisao = null;
    modeloStatusEl.textContent = "Backend de visao: servidor indisponivel";
    modeloStatusEl.className = "health offline";
    modeloStatusEl.title = "Servidor indisponivel";
  }
  atualizarDiagnostico();
}

function aplicarFiltro(): void {
  const termo = filterInput.value.trim().toLowerCase();
  for (const item of Array.from(logEl.children)) {
    const texto = (item.textContent ?? "").toLowerCase();
    (item as HTMLElement).hidden = termo.length > 0 && !texto.includes(termo);
  }
}

async function exportarLog(): Promise<void> {
  exportBtn.disabled = true;
  try {
    const entradas = await api.listarEntradas(500);
    const blob = new Blob([JSON.stringify(entradas, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    a.download = `neuro-vision-log-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus("Log exportado.");
  } catch (err) {
    setStatus(`Falha ao exportar: ${(err as Error).message}`);
  } finally {
    atualizarContagem();
  }
}

startBtn.addEventListener("click", () => void start());
stopBtn.addEventListener("click", stop);
analisarAgoraBtn.addEventListener("click", () => {
  if (!running || motorSelect.value !== "eventos") return;
  manualSolicitado = true;
  agendador.disparar();
});
clearLogBtn.addEventListener("click", () => void limparHistorico());
exportBtn.addEventListener("click", () => void exportarLog());
filterInput.addEventListener("input", aplicarFiltro);

intervalInput.addEventListener("input", () => {
  intervalValue.textContent = `${intervalInput.value}s`;
  intervaloMsConfigurado = Number(intervalInput.value) * 1000;
  agendador.reajustar();
});

thresholdInput.addEventListener("input", () => {
  thresholdValue.textContent = Number(thresholdInput.value).toFixed(2);
});

motorSelect.addEventListener("change", () => {
  ultimaDescricao = "";
  roteiroBeats = [];
  roteiroPrimeiro = true;
  frameIdAtual = gerarFrameId();
  manualSolicitado = false;
  atualizarBotoesAnalise();
  atualizarDiagnostico();
});

atualizarContagem();
atualizarDiagnostico();
void carregarHistorico();
void carregarContexto();
void verificarVisao();




